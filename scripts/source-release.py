#!/usr/bin/env python3
"""Export reviewed source without Git history or operational files."""
import argparse
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

MANIFEST = 'SOURCE_MANIFEST.json'
MAX_FILE = 8 * 1024 * 1024
PRIVATE_DIRS = {'.git', 'node_modules', 'target', 'dist', 'build', '__pycache__', '.gradle',
                '.release-prep', '.specs', '.scratch', '.ssh', '.codex', '.claude',
                'deployments', 'secrets', 'conversation-cache', 'conversation-state', 'usage-cache'}
PRIVATE_NAMES = {'.release-private-patterns.json', 'auth.json', 'credentials.json', 'local.properties'}
PRIVATE_GLOBS = ('*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.sqlite*', '*.db',
                 '*.db-*', '*.jsonl', '*.log', '*.bak', '*.backup', '*.tar.gz', '*.tgz', '*.zip')
SECRET_PATTERNS = [
    ('private key', re.compile(r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----')),
    ('access token', re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b')),
    ('API credential', re.compile(r'\bsk-[A-Za-z0-9_-]{32,}\b|\bAKIA[A-Z0-9]{16}\b')),
    ('literal credential', re.compile(r'''(?i)\b(?:api_key|client_secret|gateway_token|password)\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']''')),
]
PNG_KEEP = {b'IHDR', b'PLTE', b'IDAT', b'IEND', b'tRNS', b'gAMA', b'cHRM', b'sRGB', b'pHYs'}


def forbidden(path):
    parts = path.parts
    return (any(p in PRIVATE_DIRS for p in parts) or path.name in PRIVATE_NAMES or
            path.name == '.env' or path.name.startswith('.env.') or
            any(fnmatch.fnmatch(path.name, pattern) for pattern in PRIVATE_GLOBS) or
            parts[:2] in (('docs', 'private'), ('docs', 'images')) or
            path.name.startswith('HANDOFF-'))


def load_patterns(path):
    if path is None or not path.exists():
        return []
    data = json.loads(path.read_text())
    return [(entry['label'], re.compile(entry['regex']), bool(entry.get('text_only'))) for entry in data['patterns']]


def check_content(path, data, patterns):
    if len(data) > MAX_FILE:
        raise ValueError(f'{path}: exceeds reviewed source-file size limit')
    try:
        text = data.decode('utf-8'); binary = False
    except UnicodeDecodeError:
        text = data.decode('latin-1'); binary = True
    for rule in [*SECRET_PATTERNS, *patterns]:
        label, pattern = rule[:2]
        if binary and len(rule) > 2 and rule[2]:
            continue
        if pattern.search(text):
            raise ValueError(f'{path}: blocked by {label}')


def clean_png(data):
    if not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid PNG asset')
    result = bytearray(data[:8])
    cursor = 8
    while cursor + 12 <= len(data):
        length = int.from_bytes(data[cursor:cursor + 4], 'big')
        end = cursor + length + 12
        kind = data[cursor + 4:cursor + 8]
        if end > len(data) or kind in (b'acTL', b'fcTL', b'fdAT'):
            raise ValueError('Invalid or unreviewed animated PNG asset')
        if kind in PNG_KEEP:
            result.extend(data[cursor:end])
        cursor = end
        if kind == b'IEND':
            return bytes(result)
    raise ValueError('Incomplete PNG asset')


def selected_files(source):
    policy = json.loads((source / 'source-release.json').read_text())
    files = set()
    for pattern in policy['include']:
        if Path(pattern).is_absolute() or '..' in Path(pattern).parts:
            raise ValueError('Release patterns must be relative source paths')
        matches = list(source.glob(pattern))
        if not matches:
            raise ValueError(f'Allowlist entry has no matches: {pattern}')
        for path in matches:
            if path.is_dir():
                continue
            relative = path.relative_to(source)
            if forbidden(relative):
                raise ValueError(f'{relative}: operational path is not exportable')
            if path.is_symlink() or path.resolve() != source.resolve() / relative or not path.is_file():
                raise ValueError(f'{relative}: symlinks and non-regular source files are not exportable')
            files.add(relative)
    return sorted(files)


def audit(snapshot, patterns=()):
    records = json.loads((snapshot / MANIFEST).read_text())
    expected = set(records['files'])
    for name, digest in records['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or forbidden(path):
            raise ValueError('Manifest contains a non-source path')
        target = snapshot / path
        if target.is_symlink() or target.resolve() != snapshot.resolve() / path or not target.is_file():
            raise ValueError(f'{path}: missing or aliased source')
        data = target.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f'{path}: source changed after export')
        check_content(path, data, patterns)
        if target.suffix.lower() == '.png' and clean_png(data) != data:
            raise ValueError(f'{path}: unreviewed image metadata')
    for directory, dirs, files in os.walk(snapshot):
        # Generated dependencies and local Git metadata are never source-audited.
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'target', 'dist', 'build', '__pycache__', '.gradle')]
        for name in files:
            relative = (Path(directory) / name).relative_to(snapshot)
            if str(relative) != MANIFEST and str(relative) not in expected:
                raise ValueError(f'{relative}: unexpected file outside the source manifest')
    return len(expected)


def export(source, output, patterns=()):
    source, output = source.resolve(), output.absolute()
    if output.exists():
        raise ValueError('Output already exists; choose a new empty destination')
    selected = selected_files(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.source-export-', dir=output.parent))
    try:
        manifest = {'format': 1, 'files': {}}
        for relative in selected:
            data = (source / relative).read_bytes()
            check_content(relative, data, patterns)
            if relative.suffix.lower() == '.png':
                data = clean_png(data)
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            executable = (source / relative).stat().st_mode & 0o111
            target.chmod(0o755 if executable else 0o644)
            manifest['files'][str(relative)] = hashlib.sha256(data).hexdigest()
        (stage / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
        audit(stage, patterns)
        stage.rename(output)
        return len(selected)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def sync_manifest(source, patterns=(), check=False):
    source = source.resolve()
    target = source / MANIFEST
    if target.is_symlink():
        raise ValueError(f'{MANIFEST}: symlinks are not allowed')
    records = {'format': 1, 'files': {}}
    for relative in selected_files(source):
        data = (source / relative).read_bytes()
        check_content(relative, data, patterns)
        if relative.suffix.lower() == '.png' and clean_png(data) != data:
            raise ValueError(f'{relative}: review a clean source export before recording image metadata')
        records['files'][str(relative)] = hashlib.sha256(data).hexdigest()
    expected = (json.dumps(records, indent=2, sort_keys=True) + '\n').encode('utf-8')
    if check:
        if not target.exists() or target.read_bytes() != expected:
            raise ValueError(f'{MANIFEST}: stale or missing; run python3 scripts/source-release.py manifest')
    else:
        target.write_bytes(expected)
    return len(records['files'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-patterns', type=Path, help='Optional local private-identifier rules')
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('export')
    create.add_argument('--output', required=True, type=Path)
    inspect = commands.add_parser('audit')
    inspect.add_argument('snapshot', type=Path)
    record = commands.add_parser('manifest', help='Refresh or check the source checkout manifest')
    record.add_argument('--check', action='store_true', help='Fail instead of changing a stale manifest')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent.parent
    pattern_file = args.private_patterns or source / '.release-private-patterns.json'
    try:
        patterns = load_patterns(pattern_file)
        if args.command == 'manifest':
            count = sync_manifest(source, patterns, check=args.check)
            print(f'manifest: {count} reviewed source files {"checked" if args.check else "recorded"}')
        else:
            count = export(source, args.output, patterns) if args.command == 'export' else audit(args.snapshot, patterns)
            print(f'{args.command}: {count} reviewed source files passed; no Git history or deployment data exported')
    except (ValueError, OSError, KeyError, TypeError, re.error) as error:
        parser.exit(1, f'Source review failed: {error}\n')


if __name__ == '__main__':
    main()
