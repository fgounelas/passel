#!/usr/bin/env python3
"""Read-only, descriptor-relative Danus output access. No third-party dependencies."""
import codecs
import errno
import secrets
import hmac
import hashlib
import json
import os
from pathlib import PurePosixPath
import re
import stat
import socket
import sys
import ctypes
import platform
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore, Lock
from setup import Setup, SetupError
from cli_setup import CliSetup
from urllib.parse import parse_qs, quote, urlsplit

OUTPUTS = {'paper', 'papers', 'facts', 'report', 'reports', 'notes', 'plans', 'ops', 'audits', 'advisories', 'research'}
PHAROS_OUTPUTS = OUTPUTS | {'human_report', 'worker_report', 'checkpoints', 'materials', 'expert_guidance'}
EXTENSIONS = {'.pdf', '.tex', '.md'}
LEAN_EXTENSIONS = EXTENSIONS | {'.lean', '.txt'}
LEAN_PROJECT_FILES = {'lakefile.toml', 'lake-manifest.json', 'lean-toolchain'}
LEAN_EXCLUDED_DIRS = {'build', 'dist', 'target', 'node_modules', 'vendor', 'packages', 'cache'}
MAX_FILE = 128 * 1024 * 1024
MAX_ENTRIES = 5000
USAGE_CACHE = os.environ.get('HERDR_USAGE_CACHE', '/usage/status.json')
CONVERSATION_CACHE = os.environ.get('HERDR_CONVERSATION_CACHE', '/conversation')
UPLOAD_TEXT_EXTENSIONS = {'.tex', '.md', '.txt', '.bib', '.lean', '.csv', '.json', '.py', '.sage', '.ipynb', '.sty', '.cls'}
UPLOAD_EXTENSIONS = UPLOAD_TEXT_EXTENSIONS | {'.pdf', '.djvu', '.png', '.jpg', '.jpeg'}
TEXT_PREVIEW_EXTENSIONS = UPLOAD_TEXT_EXTENSIONS | {'.toml', '.yaml', '.yml', '.sh', '.rs', '.js', '.ts', '.tsx', '.jsx',
    '.c', '.h', '.cpp', '.hpp', '.jl', '.r', '.pl', '.log', '.ini', '.cfg', '.xml', '.html', '.css'}
TEXT_PREVIEW_NAMES = {'readme', 'license', 'makefile', 'dockerfile', 'lean-toolchain', 'copying', 'notice'}
MAX_UPLOAD = 100_000_000  # 100 MB, decimal, also enforced by nginx and the browser.
UPLOAD_RESERVE = 1024 * 1024 * 1024  # Keep at least 1 GiB free.



def open_beneath(root_fd, parts, directory):
    if sys.platform == 'linux':
        # Resolve the entire path atomically beneath the root, including during
        # concurrent directory renames. Do not fall back on older Linux kernels.
        if platform.machine() not in ('x86_64', 'aarch64'):
            raise ValueError('Unsupported secure-open platform')
        class OpenHow(ctypes.Structure):
            _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]
        how = OpenHow(os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if directory else 0), 0, 0x08 | 0x04)
        libc = ctypes.CDLL(None, use_errno=True)
        result = libc.syscall(ctypes.c_long(437), ctypes.c_int(root_fd),
                              ctypes.c_char_p(('/'.join(parts) or '.').encode()),
                              ctypes.byref(how), ctypes.c_size_t(ctypes.sizeof(how)))
        if result < 0:
            raise OSError(ctypes.get_errno(), 'Secure file open failed')
        return result
    # Local macOS test/development support. Production is Linux/openat2 only.
    fd = os.dup(root_fd)
    try:
        for i, part in enumerate(parts):
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if i < len(parts) - 1 or directory:
                flags |= os.O_DIRECTORY
            next_fd = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def run_record(name):
    return re.fullmatch(r"RUN-\d{4}-\d{2}-\d{2}\.md", name) is not None


def project_document(name, workspace=None):
    return name == 'PROBLEM.md' or run_record(name) or (workspace == 'pharos' and name == 'ROUTES.md')


def output_directories(workspace):
    return PHAROS_OUTPUTS if workspace == 'pharos' else OUTPUTS


def workflow_directory(name):
    return any(word in name.casefold() for word in ('danus', 'pharos', 'rethlas'))


def lean_path(parts, directory):
    if not parts:
        return directory
    if parts[0] != 'projects':
        return not directory and len(parts) == 1 and parts[0] == 'README.md'
    if any(part in LEAN_EXCLUDED_DIRS for part in (parts if directory else parts[:-1])):
        return False
    return directory or (len(parts) >= 3 and (
        PurePosixPath(parts[-1]).suffix.lower() in LEAN_EXTENSIONS or
        (len(parts) == 3 and parts[-1] in LEAN_PROJECT_FILES)))


def components(path, output_scope=True, workspace=None):
    if not path:
        return []
    parts = path.split('/')
    if len(parts) > 24 or any(not p or p.startswith('.') or '\\' in p or '\x00' in p for p in parts):
        raise ValueError('Invalid path')
    if output_scope and len(parts) >= 2:
        if parts[1] == 'fact_graph':
            if len(parts) >= 3 and parts[2] != 'facts':
                raise ValueError('Not a facts directory')
        elif parts[1] not in output_directories(workspace) and not (len(parts) == 2 and project_document(parts[1], workspace)):
            raise ValueError('Not an output directory')
    return parts


class Files:
    def __init__(self, roots, upload_dir=None, work_dir=None):
        # Roots are administrator-configured, never client-supplied.
        self.root_paths = dict(roots)
        self.roots = dict.fromkeys(roots)
        self.root_lock = Lock()
        try:
            for name in self.roots:
                try:
                    self.root_fd(name)
                except FileNotFoundError:
                    # Fresh workspaces may not contain any workflow projects yet.
                    pass
        except BaseException:
            for fd in self.roots.values():
                if fd is not None:
                    os.close(fd)
            raise

        self.upload_fd = os.open(upload_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW) if upload_dir else None
        self.work_fd = os.open(work_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW) if work_dir else None

    def root_fd(self, root):
        # Pin each root once it appears. Serialize lazy opens to avoid leaking
        # descriptors when multiple requests discover the first project.
        with self.root_lock:
            if self.roots[root] is None:
                self.roots[root] = os.open(self.root_paths[root],
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            return self.roots[root]

    def ordinary_parts(self, root, path):
        if root != 'work' or self.work_fd is None:
            return None
        parts = components(path, output_scope=False)
        return parts if parts and parts[0] != 'uploads' and not workflow_directory(parts[0]) else None

    def ordinary_listing(self, path):
        fd = self.open('work', path, directory=True) if path else os.dup(self.work_fd)
        try:
            result = []
            with os.scandir(fd) as entries:
                for index, entry in enumerate(entries):
                    if index >= MAX_ENTRIES:
                        raise ValueError('Directory exceeds 5000 entries; narrow the scope')
                    if entry.name.startswith('.') or entry.is_symlink():
                        continue
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    directory = stat.S_ISDIR(info.st_mode)
                    if not directory and not stat.S_ISREG(info.st_mode):
                        continue
                    if not path and (not directory or workflow_directory(entry.name) or entry.name == 'uploads'):
                        continue
                    result.append({'name': entry.name, 'directory': directory,
                                   'size': info.st_size, 'mtime': info.st_mtime})
            return sorted(result, key=lambda e: (not e['directory'], e['name'].casefold()))
        finally:
            os.close(fd)

    def upload_parts(self, root, path):
        parts = components(path, output_scope=False)
        if root == 'work' and parts[:1] == ['uploads'] and self.upload_fd is not None:
            if len(parts) > 2:
                raise ValueError('Uploads are a flat directory')
            return parts[1:]
        return None

    def close(self):
        if self.upload_fd is not None:
            os.close(self.upload_fd)
        if self.work_fd is not None:
            os.close(self.work_fd)
        for fd in self.roots.values():
            if fd is not None:
                os.close(fd)

    def work_target(self, path):
        parts = components(path, output_scope=False)
        if not parts:
            return None
        if parts[0] not in self.roots:
            raise ValueError('Unknown workspace')
        if parts[0] == 'lean':
            return 'lean', '/'.join(parts[1:])
        if len(parts) >= 2 and parts[1] != 'runtime':
            raise ValueError('Not a project branch')
        if len(parts) >= 3 and parts[2] != 'projects':
            raise ValueError('Not a project branch')
        if len(parts) < 3:
            return None
        return parts[0], '/'.join(parts[3:])

    def open(self, root, path, directory=False):
        upload_parts = self.upload_parts(root, path)
        if upload_parts is not None:
            if directory and not upload_parts:
                return os.dup(self.upload_fd)
            if directory or len(upload_parts) != 1 or PurePosixPath(path).suffix.lower() not in UPLOAD_EXTENSIONS:
                raise ValueError('Unsupported upload')
            fd = open_beneath(self.upload_fd, upload_parts, False)
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_UPLOAD:
                os.close(fd)
                raise ValueError('Unsupported upload')
            return fd
        ordinary = self.ordinary_parts(root, path)
        if ordinary is not None:
            if len(ordinary) == 1 and not directory:
                raise ValueError('Work root files are not exposed')
            fd = open_beneath(self.work_fd, ordinary, directory)
            info = os.fstat(fd)
            if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_size <= MAX_FILE):
                os.close(fd)
                raise ValueError('Unsupported file or file exceeds 128 MiB')
            return fd
        if root == 'work':
            target = self.work_target(path)
            if target is None:
                raise ValueError('Virtual directory')
            root, path = target
        parts = components(path, output_scope=root != 'lean', workspace=root)
        if root == 'lean' and not lean_path(parts, directory):
            raise ValueError('Not a Lean source or document')
        if root != 'lean' and directory and len(parts) == 2 and project_document(parts[1], root):
            raise ValueError('Not an output directory')
        if root != 'lean' and not directory and ((len(parts) < 3 and not (len(parts) == 2 and project_document(parts[1], root))) or PurePosixPath(path).suffix.lower() not in EXTENSIONS):
            raise ValueError('Unsupported file')
        fd = open_beneath(self.root_fd(root), parts, directory)
        try:
            metadata = os.fstat(fd)
            if directory:
                if not stat.S_ISDIR(metadata.st_mode):
                    raise ValueError('Not a directory')
            elif not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_FILE:
                raise ValueError('Unsupported file or file exceeds 128 MiB')
            return fd
        except BaseException:
            os.close(fd)
            raise

    def listing(self, root, path):
        upload_parts = self.upload_parts(root, path)
        if upload_parts is not None:
            if upload_parts:
                raise ValueError('Not a directory')
            result = []
            with os.scandir(self.upload_fd) as entries:
                for index, entry in enumerate(entries):
                    if index >= MAX_ENTRIES:
                        raise ValueError('Directory exceeds 5000 entries')
                    if entry.name.startswith('.') or entry.is_symlink() or PurePosixPath(entry.name).suffix.lower() not in UPLOAD_EXTENSIONS:
                        continue
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if stat.S_ISREG(info.st_mode) and info.st_size <= MAX_UPLOAD:
                        result.append({'name': entry.name, 'directory': False, 'size': info.st_size, 'mtime': info.st_mtime})
            return sorted(result, key=lambda e: e['name'].casefold())
        if self.ordinary_parts(root, path) is not None:
            return self.ordinary_listing(path)
        if root == 'work':
            target = self.work_target(path)
            if target is None:
                parts = components(path, output_scope=False)
                names = sorted(self.roots) if not parts else ['runtime'] if len(parts) == 1 else ['projects']
                if not parts and self.upload_fd is not None:
                    names = sorted([*names, 'uploads'])
                entries = {name: {'name': name, 'directory': True, 'size': 0, 'mtime': 0} for name in names}
                if not parts and self.work_fd is not None:
                    entries.update({entry['name']: entry for entry in self.ordinary_listing('')})
                return [entries[name] for name in sorted(entries, key=str.casefold)]
            return self.listing(*target)
        parts = components(path, output_scope=root != 'lean', workspace=root)
        depth = len(parts)
        try:
            fd = self.open(root, path, directory=True)
        except FileNotFoundError:
            if not parts:
                return []
            raise
        try:
            result = []
            with os.scandir(fd) as entries:
                for index, entry in enumerate(entries):
                    if index >= MAX_ENTRIES:
                        raise ValueError('Directory exceeds 5000 entries; narrow the scope')
                    if entry.name.startswith('.') or entry.is_symlink():
                        continue
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    directory = stat.S_ISDIR(info.st_mode)
                    if root == 'lean':
                        if (not directory and not stat.S_ISREG(info.st_mode)) or not lean_path([*parts, entry.name], directory):
                            continue
                        if not directory and info.st_size > MAX_FILE:
                            continue
                        result.append({'name': entry.name, 'directory': directory,
                                       'size': info.st_size, 'mtime': info.st_mtime})
                        continue
                    if depth == 0 and not directory:
                        continue
                    if depth == 1 and not ((directory and entry.name in output_directories(root) | {'fact_graph'}) or
                                           (stat.S_ISREG(info.st_mode) and project_document(entry.name, root))):
                        continue
                    if depth == 2 and parts[1] == 'fact_graph' and (not directory or entry.name != 'facts'):
                        continue
                    if depth >= 2 and not directory and (
                        not stat.S_ISREG(info.st_mode) or PurePosixPath(entry.name).suffix.lower() not in EXTENSIONS
                    ):
                        continue
                    result.append({'name': entry.name, 'directory': directory,
                                   'size': info.st_size, 'mtime': info.st_mtime})
            return sorted(result, key=lambda e: (not e['directory'], e['name'].lower()))
        finally:
            os.close(fd)

    def search(self, root, query):
        needle = query.strip().casefold()
        if not needle or len(query) > 200 or (root != 'work' and root not in self.roots):
            raise ValueError('Invalid search')
        queue = deque([''])
        results = []
        scanned = 0
        folders = 0
        incomplete = False
        deadline = time.monotonic() + 3
        while queue:
            if folders >= 10000 or scanned >= 100000 or time.monotonic() >= deadline:
                incomplete = True
                break
            path = queue.popleft()
            folders += 1
            try:
                entries = self.listing(root, path)
            except (OSError, ValueError):
                incomplete = True
                continue
            for entry in entries:
                scanned += 1
                full = '/'.join(filter(None, [path, entry['name']]))
                if entry['directory']:
                    if len(full.split('/')) < 24 and len(queue) < 2000:
                        queue.append(full)
                    else:
                        incomplete = True
                elif needle in entry['name'].casefold():
                    results.append({**entry, 'path': full})
                    if len(results) >= 500:
                        return {'entries': results, 'truncated': True}
        return {'entries': results, 'truncated': incomplete}


def byte_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
    if not match or not any(match.groups()) or size == 0:
        raise ValueError('Invalid range')
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last) if last else size - 1, size - 1)
    else:
        if int(last) <= 0:
            raise ValueError('Invalid range')
        start, end = max(0, size - int(last)), size - 1
    if start >= size or start > end:
        raise ValueError('Invalid range')
    return start, end, True



class UploadError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def upload_name(name):
    if (not name or name != name.strip() or name.startswith('.') or len(name.encode('utf-8')) > 200
            or any(ord(c) < 32 or ord(c) == 127 or c in '/\\' for c in name)
            or PurePosixPath(name).suffix.lower() not in UPLOAD_EXTENSIONS):
        raise UploadError(400, 'Use a supported extension (' + ', '.join(sorted(UPLOAD_EXTENSIONS)) + ') without path separators.')
    return name


def upload_free(fd):
    info = os.fstatvfs(fd)
    return info.f_bavail * info.f_frsize


def save_upload(directory, name, size, stream):
    """Caller serializes uploads. Stream bounded chunks into an unpublished file."""
    name = upload_name(name)
    if size <= 0 or size > MAX_UPLOAD:
        raise UploadError(413, 'Files must be between 1 byte and 100 MB.')
    if upload_free(directory) < size + UPLOAD_RESERVE:
        raise UploadError(507, 'Not enough free space. Uploads must leave at least 1 GiB free.')
    temporary = '.upload-' + secrets.token_hex(16)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    try:
        # Reserve disk blocks up front where supported, including across instances.
        if hasattr(os, 'posix_fallocate'):
            try:
                os.posix_fallocate(fd, 0, size)
            except OSError as error:
                if error.errno not in (errno.EOPNOTSUPP, errno.ENOSYS, errno.EINVAL):
                    raise
        suffix = PurePosixPath(name).suffix.lower()
        decoder = codecs.getincrementaldecoder('utf-8')('strict') if suffix in UPLOAD_TEXT_EXTENSIONS else None
        remaining, first = size, True
        deadline = time.monotonic() + 300
        with os.fdopen(fd, 'wb') as output:
            fd = None
            while remaining:
                if time.monotonic() > deadline:
                    raise UploadError(408, 'Upload timed out. Try again.')
                block = stream.read(min(65536, remaining))
                if not block:
                    raise UploadError(400, 'Upload interrupted before the declared size was received.')
                if first:
                    if suffix == '.pdf' and not block.startswith(b'%PDF-'):
                        raise UploadError(415, 'This file does not have a PDF header.')
                    if suffix == '.djvu' and not (block.startswith(b'AT&TFORM') and block[12:16] in (b'DJVU', b'DJVM')):
                        raise UploadError(415, 'This file does not have a DjVu header.')
                    if suffix == '.png' and not block.startswith(b'\x89PNG\r\n\x1a\n'):
                        raise UploadError(415, 'This file does not have a PNG header.')
                    if suffix in ('.jpg', '.jpeg') and not block.startswith(b'\xff\xd8\xff'):
                        raise UploadError(415, 'This file does not have a JPEG header.')
                    first = False
                if decoder:
                    if b'\x00' in block:
                        raise UploadError(415, 'Text, code and data uploads must be UTF-8 text without NUL bytes.')
                    try:
                        decoder.decode(block, final=len(block) == remaining)
                    except UnicodeDecodeError:
                        raise UploadError(415, 'Text, code and data uploads must be UTF-8 text.') from None
                if upload_free(directory) < UPLOAD_RESERVE:
                    raise UploadError(507, 'Free space dropped below the 1 GiB reserve. Upload cancelled.')
                output.write(block)
                remaining -= len(block)
            output.flush()
            os.fsync(output.fileno())
        stem = name[:-len(suffix)]
        for index in range(10000):
            candidate = name if index == 0 else f'{stem}-{index}{suffix}'
            try:
                # Hard link publishes atomically and fails if any file/symlink exists.
                os.link(temporary, candidate, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
                os.fsync(directory)
                return candidate
            except FileExistsError:
                continue
        raise UploadError(409, 'Too many files with this name. Rename your file and retry.')
    except OSError as error:
        if error.errno in (errno.ENOSPC, errno.EDQUOT):
            raise UploadError(507, 'Insufficient disk space or storage quota.') from None
        raise
    finally:
        if fd is not None:
            os.close(fd)
        os.unlink(temporary, dir_fd=directory)


class Handler(BaseHTTPRequestHandler):
    server_version = 'OutputFiles'

    def send_response(self, code, message=None):
        self.response_started = True
        super().send_response(code, message)

    def log_message(self, *_args):
        pass  # No filenames or credentials in access logs.

    def json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        self.do_POST()

    def do_POST(self):
        self.response_started = False
        self.close_connection = True  # Never reuse a connection with an unread rejected body.
        self.connection.settimeout(15)
        if not hmac.compare_digest(self.headers.get('X-Herdr-Gateway', '').encode(), self.server.token.encode()):
            return self.json(403, {'error': 'Forbidden'})
        if urlsplit(self.path).path in ('/api/project-files/setup', '/api/project-files/setup/clis'):
            return self.setup_request()
        if urlsplit(self.path).path == '/api/project-files/conversation/reply':
            return self.conversation_reply()
        if urlsplit(self.path).path == '/api/project-files/usage/reset':
            return self.conversation_reply(operation='usage_reset')
        if urlsplit(self.path).path == '/api/project-files/conversation/choice':
            return self.conversation_reply(operation='choice')
        if urlsplit(self.path).path == '/api/project-files/conversation/archives':
            return self.conversation_reply(operation='archives')
        if urlsplit(self.path).path == '/api/project-files/conversation/bookmarks':
            return self.conversation_reply(operation='bookmarks')
        if self.headers.get('Origin') != self.server.origin or self.headers.get('X-Herdr-Upload') != '1':
            return self.json(403, {'error': 'Forbidden origin'})
        if self.server.files.upload_fd is None:
            return self.json(404, {'error': 'Uploads are unavailable on this server.'})
        if urlsplit(self.path).path != '/api/project-files/upload':
            return self.json(404, {'error': 'Not found'})
        if not self.server.upload_slots.acquire(blocking=False):
            return self.json(429, {'error': 'Another upload is running. Try again shortly.'})
        try:
            params = parse_qs(urlsplit(self.path).query, keep_blank_values=True, max_num_fields=1)
            if set(params) != {'name'} or len(params['name']) != 1:
                raise UploadError(400, 'Exactly one filename is required.')
            if self.command == 'DELETE':
                name = upload_name(params['name'][0])
                directory = self.server.files.upload_fd
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode):
                    raise UploadError(400, 'Only regular files in the uploads folder can be deleted.')
                # Leaf-only unlink never follows symlinks, even if swapped after stat.
                os.unlink(name, dir_fd=directory)
                os.fsync(directory)
                return self.json(200, {'deleted': 'uploads/' + name})
            lengths = self.headers.get_all('Content-Length', [])
            if self.headers.get('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,12}', lengths[0]):
                raise UploadError(411, 'A valid Content-Length is required.')
            if self.headers.get('Content-Type') != 'application/octet-stream':
                raise UploadError(415, 'Upload raw file bytes as application/octet-stream.')
            name = save_upload(self.server.files.upload_fd, params['name'][0], int(lengths[0]), self.rfile)
            return self.json(201, {'name': name, 'path': 'uploads/' + name,
                                   'destination': '~/work/uploads/' + name})
        except UploadError as error:
            self.json(error.status, {'error': error.message})
        except TimeoutError:
            self.json(408, {'error': 'Upload timed out. Try again.'})
        except (OSError, ValueError):
            if not self.response_started:
                self.json(400, {'error': 'File operation failed. Refresh Files and try again.'})
        finally:
            self.server.upload_slots.release()

    def conversation_reply(self, operation=None):
        if self.command != 'POST' or urlsplit(self.path).query:
            return self.json(405, {'error': 'Method not allowed'})
        if self.headers.get('Origin') != self.server.origin or self.headers.get('X-Herdr-Conversation') != '1':
            return self.json(403, {'error': 'Forbidden origin'})
        lengths = self.headers.get_all('Content-Length', [])
        if (self.headers.get('Transfer-Encoding') or len(lengths) != 1 or
                not re.fullmatch(r'[0-9]{1,6}', lengths[0]) or not 0 < int(lengths[0]) <= 100_000):
            return self.json(413, {'error': 'Invalid reply size'})
        if self.headers.get('Content-Type') != 'application/json':
            return self.json(415, {'error': 'Expected JSON'})
        try:
            body = self.rfile.read(int(lengths[0]))
            # Re-encode as one framed JSON object; raw newlines cannot inject requests.
            value = json.loads(body)
            if not isinstance(value, dict) or 'operation' in value:
                return self.json(400, {'error': 'Invalid request'})
            if operation:
                value['operation'] = operation
            body = json.dumps(value).encode() + b'\n'
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(35 if operation == 'usage_reset' else 12)
                conn.connect(CONVERSATION_CACHE + '/reply.sock')
                conn.sendall(body)
                with conn.makefile('rb') as stream:
                    result = json.loads(stream.readline(4 * 1024 * 1024 + 1 if operation else 8192))
            code = result.pop('code')
            if code not in (200, 400, 409, 429, 502, 503):
                raise ValueError('Invalid response')
            return self.json(code, result)
        except (OSError, ValueError, KeyError):
            return self.json(502, {'error': 'Delivery could not be confirmed. Check the conversation or Terminal before resending.'})

    def setup_request(self):
        if self.command != 'POST' or urlsplit(self.path).query:
            return self.json(405, {'error': 'Method not allowed'})
        if self.headers.get('Origin') != self.server.origin or self.headers.get('X-Herdr-Setup') != '1':
            return self.json(403, {'error': 'Forbidden origin'})
        lengths = self.headers.get_all('Content-Length', [])
        if (self.headers.get('Transfer-Encoding') or len(lengths) != 1
                or not re.fullmatch(r'[0-9]{1,4}', lengths[0]) or not 0 < int(lengths[0]) <= 2048):
            return self.json(413, {'error': 'Invalid setup request size'})
        if self.headers.get('Content-Type') != 'application/json':
            return self.json(415, {'error': 'Expected JSON'})
        try:
            value = json.loads(self.rfile.read(int(lengths[0])))
            if not isinstance(value, dict):
                raise SetupError(400, 'Invalid setup request')
            if urlsplit(self.path).path == '/api/project-files/setup/clis':
                if set(value) != {'cli', 'action'}:
                    raise SetupError(400, 'Choose a supported CLI and Install or Update.')
                return self.json(200, self.server.cli_setup.change(value['cli'], value['action']))
            if set(value) == {'project'}:
                return self.json(200, self.server.setup.install(value['project']))
            if set(value) == {'startup_path'}:
                return self.json(200, self.server.setup.set_startup_path(value['startup_path']))
            raise SetupError(400, 'Choose a project or a terminal startup path.')
        except SetupError as error:
            return self.json(error.status, {'error': error.message})
        except (OSError, ValueError):
            return self.json(400, {'error': 'Setup could not be completed. Check the project folders and settings on this server.'})

    def do_GET(self):
        self.response_started = False
        self.connection.settimeout(15)
        if not hmac.compare_digest(self.headers.get('X-Herdr-Gateway', '').encode(), self.server.token.encode()):
            return self.json(403, {'error': 'Forbidden'})
        if self.headers.get('Origin', self.server.origin) != self.server.origin:
            return self.json(403, {'error': 'Forbidden origin'})
        try:
            url = urlsplit(self.path)
            params = parse_qs(url.query, keep_blank_values=True, max_num_fields=8)
            if any(len(v) != 1 for v in params.values()):
                raise ValueError('Duplicate parameters')
            root = params.get('root', [''])[0]
            path = params.get('path', [''])[0]
            if url.path in ('/api/project-files/setup', '/api/project-files/setup/clis'):
                if params:
                    raise ValueError('Unexpected setup parameters')
                try:
                    return self.json(200, (self.server.cli_setup if url.path.endswith('/clis') else self.server.setup).status())
                except SetupError as error:
                    return self.json(error.status, {'error': error.message})
            if url.path == '/api/project-files/conversation/history':
                expected = {'pane', 'session', 'direction', 'cursor'}
                if params.get('direction') == ['search']:
                    expected.add('query')
                if set(params) != expected:
                    raise ValueError('Invalid history query')
                values = {k: v[0] for k, v in params.items()}
                if (not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', values['pane']) or
                        not re.fullmatch(r'[a-fA-F0-9-]{36}', values['session']) or
                        values['direction'] not in ('before', 'after', 'start', 'search', 'prompt') or
                        not re.fullmatch(r'[0-9]{1,15}', values['cursor'])):
                    raise ValueError('Invalid history query')
                if values['direction'] == 'search' and not 1 <= len(values.get('query', '').strip()) <= 200:
                    raise ValueError('Invalid search')
                body = {'operation': 'history', **values, 'cursor': int(values['cursor'])}
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                    conn.settimeout(12)
                    conn.connect(CONVERSATION_CACHE + '/reply.sock')
                    conn.sendall(json.dumps(body).encode() + b'\n')
                    with conn.makefile('rb') as stream:
                        result = json.loads(stream.readline(4 * 1024 * 1024 + 1))
                code = result.pop('code')
                if code not in (200, 400, 409, 429, 502, 503):
                    raise ValueError('Invalid history response')
                return self.json(code, result)
            if url.path == '/api/project-files/conversation':
                pane = params.get('pane', [''])[0]
                if set(params) != {'pane'} or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane):
                    raise ValueError('Invalid pane')
                name = hashlib.sha256(pane.encode()).hexdigest() + '.json'
                try:
                    fd = os.open(CONVERSATION_CACHE + '/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(fd, 'rb') as stream:
                        info = os.fstat(stream.fileno())
                        if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024 * 1024:
                            raise ValueError('Invalid conversation cache')
                        value = json.load(stream)
                except FileNotFoundError:
                    return self.json(200, {'status': 'unavailable', 'messages': []})
                if time.time() - value.get('observedAt', 0) > 30:
                    return self.json(200, {'status': 'stale', 'messages': []})
                return self.json(200, {**value, 'status': 'ok'})
            if url.path == '/api/project-files/usage':
                pane = params.get('pane', [''])[0]
                if not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane):
                    raise ValueError('Invalid pane')
                fd = os.open(USAGE_CACHE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
                        raise ValueError('Invalid cache')
                    cache = json.load(stream)
                value = cache.get('panes', {}).get(pane)
                # Collector absence or old pane mapping must never select another account.
                if time.time() - cache.get('updatedAt', 0) > 150:
                    return self.json(200, {'status': 'Quota observer offline', 'windows': []})
                return self.json(200, value or {'status': 'No supported agent profile in this pane', 'windows': []})
            if url.path == '/api/project-files/upload-info':
                return self.json(200, {'enabled': self.server.files.upload_fd is not None,
                    'maxBytes': MAX_UPLOAD, 'extensions': sorted(UPLOAD_EXTENSIONS),
                    'destination': '~/work/uploads'})
            if url.path == '/api/project-files/roots':
                return self.json(200, {'roots': ['work'], **({'paths': {'work': self.server.work_host_dir}}
                    if self.server.work_host_dir else {})})
            if url.path == '/api/project-files/list':
                return self.json(200, {'entries': self.server.files.listing(root, path)})
            if url.path == '/api/project-files/search':
                if not self.server.search_slots.acquire(blocking=False):
                    return self.json(429, {'error': 'Search busy. Try again shortly.'})
                try:
                    return self.json(200, self.server.files.search(root, params.get('q', [''])[0]))
                finally:
                    self.server.search_slots.release()
            if url.path != '/api/project-files/content':
                return self.json(404, {'error': 'Not found'})
            fd = self.server.files.open(root, path)
            with os.fdopen(fd, 'rb') as file:
                size = os.fstat(file.fileno()).st_size
                try:
                    start, end, partial = byte_range(self.headers.get('Range'), size)
                except ValueError:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.end_headers()
                    return
                pdf = path.lower().endswith('.pdf')
                suffix = PurePosixPath(path).suffix.lower()
                text = suffix in TEXT_PREVIEW_EXTENSIONS or PurePosixPath(path).name.casefold() in TEXT_PREVIEW_NAMES
                download = (not pdf and not text) or params.get('download', ['0'])[0] == '1'
                if not pdf and not download and size > 2 * 1024 * 1024:
                    return self.json(413, {'error': 'Text preview exceeds 2 MiB; use Download'})
                length = max(0, end - start + 1)
                self.send_response(206 if partial else 200)
                self.send_header('Content-Type', {'.pdf': 'application/pdf', '.djvu': 'image/vnd.djvu',
                    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(suffix, 'text/plain; charset=utf-8' if text else 'application/octet-stream'))
                self.send_header('Content-Length', str(length))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'private, no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'none'; sandbox")
                disposition = 'attachment' if download else 'inline'
                self.send_header('Content-Disposition', f"{disposition}; filename*=UTF-8''{quote(PurePosixPath(path).name, safe='')}")
                if partial:
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.end_headers()
                file.seek(start)
                while length:
                    block = file.read(min(length, 65536))
                    if not block:
                        break
                    self.wfile.write(block)
                    length -= len(block)
        except (OSError, ValueError, KeyError):
            if not self.response_started:
                # Error responses reveal neither absolute paths nor private filenames.
                try:
                    self.json(404, {'error': 'Output unavailable or path not allowed'})
                except OSError:
                    pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, roots, token, origin, upload_dir=None, work_dir=None, work_host_dir=None):
        if len(token) < 32:
            raise ValueError('A private gateway credential is required')
        if work_host_dir is not None and (not isinstance(work_host_dir, str) or
                not work_host_dir.startswith('/') or '\\' in work_host_dir or
                any(ord(c) < 32 for c in work_host_dir) or '..' in PurePosixPath(work_host_dir).parts):
            raise ValueError('An absolute host work path is required')
        # Display metadata only: this never changes the descriptor-relative access roots.
        self.work_host_dir = work_host_dir.rstrip('/') if work_host_dir else None
        self.files = Files(roots, upload_dir, work_dir)
        self.setup = Setup()
        self.cli_setup = CliSetup()
        self.token, self.origin = token, origin
        self.slots = BoundedSemaphore(16)
        self.search_slots = BoundedSemaphore(2)
        self.upload_slots = BoundedSemaphore(1)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        request.settimeout(15)
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def server_close(self):
        super().server_close()
        self.files.close()


if __name__ == '__main__':
    from pathlib import Path
    roots = json.loads(os.environ.get('HERDR_OUTPUT_ROOTS', '{}'))
    token = Path(os.environ.get('HERDR_GATEWAY_TOKEN_FILE', '/run/herdr-web/gateway-token')).read_text().strip()
    with Server(('127.0.0.1', 8788), roots, token,
                os.environ.get('HERDR_OUTPUT_ORIGIN', 'http://127.0.0.1:8787'),
                os.environ.get('HERDR_DANUS_UPLOAD_DIR'), os.environ.get('HERDR_WORK_DIR'),
                os.environ.get('HERDR_WORK_HOST_DIR')) as server:
        server.serve_forever()
