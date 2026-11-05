#!/usr/bin/env python3
"""Supervise one trusted user's Passel workspace inside a single container."""
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path('/opt/passel')
RESEARCH_HOME = Path('/home/passel')
WORK = RESEARCH_HOME / 'work'
STATE = Path(os.environ.get('PASSEL_STATE_DIR', RESEARCH_HOME / 'containers/passel'))
SOCKET = RESEARCH_HOME / '.config/herdr/herdr.sock'
TOKEN_FILE = RESEARCH_HOME / '.local/share/passel/gateway-token'


def origin_settings():
    origin = os.environ.get('PASSEL_ORIGIN', 'http://127.0.0.1:8787')
    url = urlsplit(origin)
    if (url.scheme not in ('http', 'https') or not url.hostname or url.username
            or url.password or url.path or url.query or url.fragment
            or not re.fullmatch(r'[A-Za-z0-9.\-:\[\]]+', url.netloc)):
        raise ValueError('PASSEL_ORIGIN must be an exact HTTP(S) origin without a path')
    _ = url.port
    return origin, url.netloc


def migrate_legacy_state():
    legacy = RESEARCH_HOME / 'containers/herdr-web'
    if STATE != RESEARCH_HOME / 'containers/passel' or legacy.is_symlink() or not legacy.exists():
        return
    if not legacy.is_dir() or STATE.exists() or STATE.is_symlink():
        raise ValueError('Cannot migrate legacy Passel state: inspect both containers/herdr-web and containers/passel before restarting')
    # Preserve absolute launcher paths in existing archive records. A fresh
    # home (or an empty old directory) needs no compatibility alias.
    keep_alias = any(legacy.iterdir())
    legacy.rename(STATE)
    if keep_alias:
        legacy.symlink_to(STATE.name, target_is_directory=True)


def initialize():
    migrate_legacy_state()
    for path in [WORK / 'danus', WORK / 'pharos', WORK / 'uploads',
                 STATE / 'conversation-cache', STATE / 'conversation-state',
                 STATE / 'usage-cache', TOKEN_FILE.parent]:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not TOKEN_FILE.exists():
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(secrets.token_hex(32) + '\n')
    token = TOKEN_FILE.read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{64}', token):
        raise ValueError('Invalid private gateway token')
    _, host = origin_settings()
    template = (ROOT / 'docker/nginx.conf').read_text()
    target = Path('/tmp/passel-nginx.conf')
    target.write_text(template.replace('@PASSEL_HOST@', host).replace('@GATEWAY_TOKEN@', token))
    target.chmod(0o600)


def runtime_health():
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        connection.connect(str(SOCKET))
        connection.sendall(b'{"id":"passel-health","method":"ping","params":{}}\n')
        with connection.makefile('rb') as stream:
            value = json.loads(stream.readline(256_001))
        if (value.get('id') != 'passel-health' or 'error' in value
                or value.get('result', {}).get('type') != 'pong'):
            raise RuntimeError('Herdr is not ready')


def health():
    _, host = origin_settings()
    for path in ['/api/capabilities', '/api/project-files/roots']:
        with urlopen(Request('http://127.0.0.1:8080' + path, headers={'Host': host}), timeout=2) as response:
            if response.status != 200:
                raise RuntimeError('Passel is not ready')


def supervise():
    initialize()
    origin, _ = origin_settings()
    children = []
    specifications = []
    stopping = False

    def stop(_signal, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def start(argv, extra_env=None):
        environment = {**os.environ, **(extra_env or {})}
        child = subprocess.Popen(argv, cwd=WORK, start_new_session=True,
                                 env=environment)
        children.append(child)
        specifications.append([argv, environment, 0, 0.0, time.monotonic()])
        return child

    try:
        # Herdr seeds its first shell separately from Passel's new-session API.
        # The hint is ignored when Herdr restores an existing workspace layout.
        daemon = start(['herdr', 'server'], {'HERDR_STARTUP_CWD': str(WORK)})
        for _ in range(200):
            if stopping or daemon.poll() is not None:
                raise RuntimeError('Herdr stopped before it was ready')
            try:
                runtime_health()
                break
            except (OSError, ValueError, RuntimeError):
                time.sleep(0.1)
        else:
            raise RuntimeError('Herdr did not become ready')
        start(['passel-bridge', '--host', '127.0.0.1', '--port', '8787',
               '--static-dir', str(ROOT / 'web'), '--upload-dir', str(WORK / 'uploads'),
               '--launcher-presets', str(ROOT / 'launcher-presets.json'), '--allow-origin', origin])
        start(['flock', '-n', str(STATE / '.observer.lock'),
               'python3', str(ROOT / 'conversation-service/collector.py')],
              {'HERDR_CONVERSATION_SESSION': 'default'})
        start(['python3', str(ROOT / 'usage-service/collector.py')],
              {'HERDR_QUOTA_SOCKET': str(SOCKET)})
        start(['python3', str(ROOT / 'files-service/server.py')], {
            'HERDR_OUTPUT_ROOTS': json.dumps({'danus': str(WORK / 'danus/runtime/projects'), 'pharos': str(WORK / 'pharos/runtime/projects')}),
            'HERDR_WORK_DIR': str(WORK), 'HERDR_WORK_HOST_DIR': str(WORK),
            'HERDR_DANUS_UPLOAD_DIR': str(WORK / 'uploads'), 'HERDR_OUTPUT_ORIGIN': origin,
            'HERDR_GATEWAY_TOKEN_FILE': str(TOKEN_FILE),
            'HERDR_CONVERSATION_CACHE': str(STATE / 'conversation-cache'),
            'HERDR_USAGE_CACHE': str(STATE / 'usage-cache/status.json'),
        })
        start(['nginx', '-c', '/tmp/passel-nginx.conf', '-g', 'daemon off;'])
        while not stopping:
            for index, child in enumerate(children):
                if child.poll() is None:
                    continue
                if child is daemon:
                    raise RuntimeError('Herdr exited; restarting the workspace')
                argv, environment, attempts, retry_at, started_at = specifications[index]
                now = time.monotonic()
                if now < retry_at:
                    continue
                if now - started_at > 60:
                    attempts = 0
                delay = min(30, 2 ** min(attempts, 5))
                specifications[index][2:4] = [attempts + 1, now + delay]
                # Reap a failed auxiliary service without stopping Herdr/agents.
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    children[index] = subprocess.Popen(argv, cwd=WORK,
                        start_new_session=True, env=environment)
                    specifications[index][4] = now
                    print(f'Restarted {Path(argv[0]).name}; research sessions kept running.', flush=True)
                except OSError:
                    print(f'Could not restart {Path(argv[0]).name}; retrying.', flush=True)
            time.sleep(0.5)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + 8
        for child in reversed(children):
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == '__main__':
    os.umask(0o077)
    try:
        command = sys.argv[1] if len(sys.argv) == 2 else ''
        if command == 'serve': supervise()
        elif command == 'health': health()
        else: raise ValueError('Choose serve or health')
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Passel stopped: {error}', file=sys.stderr)
        raise SystemExit(1) from None
