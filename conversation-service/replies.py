"""Narrow local reply service. No browser-controlled commands or socket paths."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import sqlite3
import stat
import threading
import subprocess

SESSION = os.environ.get('HERDR_CONVERSATION_SESSION', 'work')
if SESSION not in ('work', 'default'):
    raise ValueError('Unsupported Herdr conversation session')
API_SOCKET = Path.home() / ('.config/herdr/herdr.sock' if SESSION == 'default' else '.config/herdr/sessions/work/herdr.sock')
MAX_BODY = 100_000
MAX_TEXT = 16_000


class ReplyError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def validate_reply(body):
    if not isinstance(body, dict) or set(body) != {'pane', 'session', 'text'}:
        raise ReplyError(400, 'Invalid reply.')
    pane, session, text = body['pane'], body['session'], body['text']
    if not isinstance(pane, str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane):
        raise ReplyError(400, 'Invalid pane.')
    if not isinstance(session, str) or not re.fullmatch(r'[a-fA-F0-9-]{36}', session):
        raise ReplyError(400, 'Invalid conversation.')
    if not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_TEXT:
        raise ReplyError(400, 'Write a reply of at most 16,000 bytes.')
    if any(ord(c) < 32 and c not in '\n\t' or ord(c) == 127 for c in text):
        raise ReplyError(400, 'Reply contains unsupported control characters.')
    return pane, session, text


def api_request(method, params):
    # Both callers below use fixed methods. Never forward an arbitrary method.
    assert method in ('pane.process_info', 'pane.send_input', 'session.snapshot', 'pane.read', 'pane.get')
    request = {'id': 'passel-conversation', 'method': method, 'params': params}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(5)
        conn.connect(str(API_SOCKET))
        conn.sendall(json.dumps(request).encode() + b'\n')
        with conn.makefile('rb') as stream:
            line = stream.readline(1024 * 1024 + 1)
        if len(line) > 1024 * 1024 or not line.endswith(b'\n'):
            raise ValueError('Invalid API response')
        response = json.loads(line)
        if 'error' in response or response.get('id') != request['id']:
            raise ValueError('API request rejected')
        return response['result']


def send_reply(body, discover, request=api_request):
    pane, session, text = validate_reply(body)
    current = discover().get(pane)
    if not current or current[1] != session:
        raise ReplyError(409, 'The conversation changed or is no longer attached. Refresh before sending.')
    info = request('pane.process_info', {'pane_id': pane})
    processes = info.get('process_info', {}).get('foreground_processes', [])
    expected_agent = ('claude' if current[0] and Path(current[0]).is_relative_to(
        Path.home() / '.claude/projects') else 'codex')
    if current[0] is None:
        # Discovery already proved this empty TUI's identity/lifetime. Claude,
        # like Codex, creates its transcript only after the first real message.
        agents = {p.get('name') for p in processes if p.get('name') in ('codex', 'claude')
                  and not any(arg in ('--print', '-p') for arg in p.get('argv', []))}
        if len(agents) != 1:
            raise ReplyError(409, 'The conversation agent is ambiguous. Check Terminal before sending.')
        expected_agent = next(iter(agents))
    if not any(p.get('name') == expected_agent for p in processes):
        raise ReplyError(409, 'The conversation agent is not in the foreground. Check Terminal before sending.')
    # Browser choice polling can lag behind a newly opened prompt. Do not type a
    # normal reply/Enter into an approval or question, including while scrolled up.
    from choices import CHOICE, claude_approval
    read = request('pane.read', {'pane_id': pane, 'source': 'detection',
                               'lines': 80, 'format': 'text', 'strip_ansi': True})['read']
    screen = read['text'][-12000:]
    if CHOICE.search(screen) or claude_approval(screen):
        raise ReplyError(409, 'A question or approval is open. Use its choices or check Terminal before sending.')
    # Literal text and one Enter in the same daemon call. No terminal attach,
    # resize, shell interpolation, raw escape input, or automatic retries.
    request('pane.send_input', {'pane_id': pane, 'text': text, 'keys': ['Enter']})
    return {'status': 'sent'}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(12)
        try:
            line = self.rfile.readline(MAX_BODY + 1)
            if len(line) > MAX_BODY or not line.endswith(b'\n'):
                raise ReplyError(400, 'Invalid reply.')
            body = json.loads(line)
            with self.server.input_guard(body):
                if isinstance(body, dict) and body.get('operation') == 'history':
                    from history import history_request
                    result = history_request(body, self.server.discover)
                elif isinstance(body, dict) and body.get('operation') == 'bookmarks':
                    from bookmarks import bookmark_request
                    result = bookmark_request(body, self.server.discover, self.server.bookmarks)
                elif isinstance(body, dict) and body.get('operation') == 'choice':
                    from choices import choice_request
                    result = choice_request(body)
                elif isinstance(body, dict) and body.get('operation') == 'archives':
                    result = self.server.archives.request(body, self.server.discover)
                elif isinstance(body, dict) and body.get('operation') == 'usage_reset':
                    from quota_reset import reset_request
                    result = reset_request(body, self.server.bookmarks.path.parent / 'quota-resets.sqlite')
                else:
                    result = send_reply(body, self.server.discover)
            response = {'code': 200, **result}
        except ReplyError as e:
            response = {'code': e.status, 'error': e.message}
        except (OSError, ValueError, KeyError, TypeError, sqlite3.Error, subprocess.SubprocessError):
            reset = isinstance(locals().get('body'), dict) and body.get('operation') == 'usage_reset'
            response = {'code': 502, 'error': 'Reset result is unknown. Refresh usage or retry the same attempt.' if reset else
                        'Delivery could not be confirmed. Check the conversation or Terminal before resending.'}
        try:
            self.wfile.write(json.dumps(response).encode() + b'\n')
        except OSError:
            pass


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    def __init__(self, path, discover):
        from bookmarks import Bookmarks
        from archives import Archives
        self.archives = Archives(Path(path).parent.parent / 'conversation-state' / 'archives.sqlite')
        self.bookmarks = Bookmarks(Path(path).parent.parent / 'conversation-state' / 'bookmarks.sqlite')
        self.discover = discover
        self.sending = threading.BoundedSemaphore(1)
        self.resetting = threading.BoundedSemaphore(1)
        self.slots = threading.BoundedSemaphore(4)
        super().__init__(str(path), Handler)

    @contextmanager
    def input_guard(self, body):
        if isinstance(body, dict) and body.get('operation') == 'usage_reset':
            if not self.resetting.acquire(blocking=False):
                raise ReplyError(429, 'Another reset is being checked. Try again after it finishes.')
            try:
                yield
            finally:
                self.resetting.release()
            return
        # Background reads must never contend with terminal input. Bookmark writes
        # have their own SQLite transactions and do not type into the terminal.
        independent = isinstance(body, dict) and (
            body.get('operation') in ('history', 'bookmarks') or
            body.get('operation') == 'choice' and body.get('action') == 'inspect')
        if independent:
            yield
            return
        # Serialize actual controls, with a short bounded wait and no input retry.
        if not self.sending.acquire(timeout=2):
            raise ReplyError(503, 'Session control timed out. Nothing was sent.')
        try:
            yield
        finally:
            self.sending.release()

    def process_request(self, request, client_address):
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


def start_reply_server(path, discover):
    if path.exists():
        info = path.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('Unsafe reply socket')
        path.unlink()  # Caller holds the singleton observer flock.
    server = Server(path, discover)
    path.chmod(0o600)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
