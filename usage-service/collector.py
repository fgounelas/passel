#!/usr/bin/env python3
"""Per-user quota observer. No terminal input, threads, turns, or credential endpoints."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import tempfile
import time

BASE = Path(os.environ.get('PASSEL_STATE_DIR', Path.home() / 'containers/herdr-web'))
CACHE = BASE / 'usage-cache'
QUOTA_SOCKET = os.environ.get('HERDR_QUOTA_SOCKET')
PROFILES = {
    str(Path.home() / '.codex'): 'Default Codex',
    str(Path.home() / 'work/danus/runtime/codex-home'): 'Danus Codex',
    str(Path.home() / 'work/danus-mine/runtime/codex-home'): 'Danus Mine Codex',
}

def atomic_json(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.quota-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(data, stream)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def window(value, minutes, bucket):
    if not isinstance(value, dict):
        return None
    used = value.get('usedPercent', value.get('used_percentage'))
    duration = value.get('windowDurationMins', minutes)
    reset = value.get('resetsAt', value.get('resets_at'))
    if not number(used) or used < 0 or not number(duration) or duration <= 0:
        return None
    return {'bucket': str(bucket)[:80], 'minutes': duration,
            'remaining': max(0, 100 - used),
            'resetsAt': reset if number(reset) and reset > 0 else None}

def codex_windows(result):
    buckets = result.get('rateLimitsByLimitId')
    if not isinstance(buckets, dict) or not buckets:
        single = result.get('rateLimits') or {}
        buckets = {single.get('limitId') or 'codex': single}
    windows = []
    for key, bucket in buckets.items():
        if isinstance(bucket, dict):
            for field in ('primary', 'secondary'):
                value = window(bucket.get(field), None, key)
                if value:
                    windows.append(value)
    return windows[:30]

def claude_windows(data):
    limits = data.get('rate_limits') or {}
    return [w for key, minutes in [('five_hour', 300), ('seven_day', 10080)]
            if (w := window(limits.get(key), minutes, 'claude'))]

def codex_extras(result, home):
    buckets = result.get('rateLimitsByLimitId')
    if not isinstance(buckets, dict) or not buckets:
        single = result.get('rateLimits') or {}
        buckets = {single.get('limitId') or 'codex': single}
    balances = []
    for name, bucket in list(buckets.items())[:30]:
        value = bucket.get('credits') if isinstance(bucket, dict) else None
        if not isinstance(value, dict) or type(value.get('hasCredits')) is not bool or type(value.get('unlimited')) is not bool:
            continue
        balance = value.get('balance')
        balance = balance if isinstance(balance, str) and len(balance) <= 50 and re.fullmatch(r'-?\d+(?:\.\d+)?', balance) else None
        balances.append({'bucket': str(name)[:80], 'balance': balance,
                         'hasCredits': value['hasCredits'], 'unlimited': value['unlimited']})
    summary = result.get('rateLimitResetCredits')
    resets = None
    if isinstance(summary, dict) and type(summary.get('availableCount')) is int and 0 <= summary['availableCount'] <= 100000:
        rows = summary.get('credits')
        normalized = None if not isinstance(rows, list) else []
        for row in rows[:40] if isinstance(rows, list) else []:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not 0 < len(row['id']) <= 256:
                continue
            expiry = row.get('expiresAt')
            known = 'expiresAt' in row and (expiry is None or number(expiry) and 0 <= expiry <= 253402300799)
            normalized.append({'id': row['id'], 'title': str(row.get('title') or 'Banked reset')[:200],
                'description': str(row.get('description') or '')[:600],
                'resetType': row.get('resetType') if row.get('resetType') == 'codexRateLimits' else 'unknown',
                'status': row.get('status') if row.get('status') in ('available', 'redeeming', 'redeemed') else 'unknown',
                'expiresAt': expiry if known else None, 'expiryKnown': known})
        resets = {'availableCount': summary['availableCount'], 'credits': normalized}
    account = result.get('accountId')
    key = hashlib.sha256((home + '\0' + account).encode()).hexdigest() if isinstance(account, str) and 0 < len(account) <= 500 else None
    return {'credits': balances, 'bankedResets': resets, 'accountKey': key}

class CodexReader:
    def __init__(self, home, allow_reset=False):
        self.allow_reset = allow_reset
        # Fixed executable and explicitly approved profiles, never browser-supplied paths.
        command = [str(Path.home() / '.local/bin/codex'), 'app-server']
        if allow_reset:
            # The caller is the capped conversation observer. prlimit resets
            # only this new process; avoid unsafe preexec_fn in its threaded server.
            command = ['/usr/bin/prlimit', '--as=unlimited', '--', *command]
        self.process = subprocess.Popen(command,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            cwd=str(BASE), start_new_session=True,
            env={'HOME': str(Path.home()), 'PATH': '/usr/local/bin:/usr/bin:/bin',
                 'CODEX_HOME': home})
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b''
        self.request_id = 0
        self.deadline = time.monotonic() + 25

    def send(self, message):
        self.process.stdin.write(json.dumps(message).encode() + b'\n')
        self.process.stdin.flush()

    def call(self, method, params=None):
        assert method in ('initialize', 'account/read', 'account/rateLimits/read') or (
            self.allow_reset and method == 'account/rateLimitResetCredit/consume')
        self.request_id += 1
        self.send({'id': self.request_id, 'method': method, 'params': params or {}})
        while time.monotonic() < self.deadline:
            while b'\n' in self.buffer:
                line, self.buffer = self.buffer.split(b'\n', 1)
                message = json.loads(line)
                if message.get('id') == self.request_id:
                    if 'error' in message:
                        raise ValueError('Provider quota unavailable')
                    return message.get('result') or {}
            if not self.selector.select(max(0, self.deadline - time.monotonic())):
                break
            data = os.read(self.process.stdout.fileno(), 65536)
            if not data:
                raise ValueError('Account client exited before returning a result.')
            if len(self.buffer) + len(data) > 2 * 1024 * 1024:
                break
            self.buffer += data
        raise TimeoutError('Quota request timed out')

    def close(self):
        self.selector.close()
        # This process group contains only this observer's child, never existing agents.
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=3)
        self.process.stdin.close()
        self.process.stdout.close()

def read_codex(home):
    client = CodexReader(home)
    try:
        client.call('initialize', {'clientInfo': {'name': 'herdr_quota_observer', 'version': '1.0.0'}})
        client.send({'method': 'initialized', 'params': {}})
        account = client.call('account/read', {'refreshToken': False}).get('account') or {}
        if account.get('type') != 'chatgpt':
            return {'account': PROFILES[home], 'windows': [], 'credits': [], 'bankedResets': None,
                    'accountKey': None, 'status': 'No ChatGPT subscription quota'}
        limits = client.call('account/rateLimits/read')
        windows = codex_windows(limits)
        return {'account': str(account.get('email') or PROFILES[home])[:160], 'windows': windows,
                **codex_extras(limits, home), 'status': 'ok' if windows else 'Quota not reported'}
    finally:
        client.close()

def herdr(*args):
    command = ['/usr/local/bin/herdr', *([] if QUOTA_SOCKET else ['--session', 'work']), *args]
    env = {**os.environ, 'HERDR_SOCKET_PATH': QUOTA_SOCKET} if QUOTA_SOCKET else None
    result = subprocess.run(command, env=env, capture_output=True, check=True, timeout=8)
    return json.loads(result.stdout)['result']

def process_profile(process, pane_id):
    pid = process.get('pid')
    if not isinstance(pid, int) or process.get('name') not in ('codex', 'claude'):
        return None
    if process['name'] == 'claude':
        argv = process.get('argv') or []
        # SDK/print workers inherit the pane and foreground group, but are not
        # its interactive Claude session. Do not make that session ambiguous.
        options = argv[1:argv.index('--')] if '--' in argv else argv[1:]
        if any(arg in ('--print', '-p') or arg.startswith('--print=') for arg in options):
            return None
    proc = Path('/proc') / str(pid)
    if proc.stat().st_uid != os.getuid():
        return None
    # Only these three non-secret fields are retained; never emit/dump environments.
    allowed = {b'CODEX_HOME', b'CLAUDE_CONFIG_DIR', b'HERDR_PANE_ID', b'HERDR_SOCKET_PATH'}
    env = {key.decode(): value.decode() for entry in (proc / 'environ').read_bytes().split(b'\0')
           if b'=' in entry for key, value in [entry.split(b'=', 1)] if key in allowed}
    provider = process['name']
    if env.get('HERDR_PANE_ID') != pane_id:
        expected_socket = QUOTA_SOCKET or str(Path.home() / '.config/herdr/sessions/work/herdr.sock')
        # process-info already supplied this PID from the current pane. For a
        # moved Claude TUI, retain daemon/profile/UID checks rather than old IDs.
        if (provider != 'claude' or env.get('HERDR_SOCKET_PATH') != expected_socket
                or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', env.get('HERDR_PANE_ID', ''))):
            return None
    if provider == 'codex':
        home = env.get('CODEX_HOME', str(Path.home() / '.codex'))
        return (provider, home, pid) if home in PROFILES else None
    home = env.get('CLAUDE_CONFIG_DIR', str(Path.home() / '.claude'))
    return (provider, home, pid) if home == str(Path.home() / '.claude') else None


def claude_cache_path(pid, start_time):
    identity = hashlib.sha256(f'{pid}:{start_time}'.encode()).hexdigest()[:20]
    return CACHE / ('claude-process-' + identity + '.json')

def bounded_quota(value):
    """Keep all128 pane entries below the sidecar's1MiB cache budget."""
    result = {**value, 'windows': list(value.get('windows', []))}
    if isinstance(value.get('credits'), list): result['credits'] = list(value['credits'])
    if isinstance(value.get('bankedResets'), dict):
        result['bankedResets'] = {**value['bankedResets']}
        if isinstance(result['bankedResets'].get('credits'), list):
            result['bankedResets']['credits'] = list(result['bankedResets']['credits'])
    while len(json.dumps(result).encode()) > 6500:
        rows = (result.get('bankedResets') or {}).get('credits')
        if rows:
            rows.pop(); result['bankedResets']['detailsTruncated'] = True
        elif result.get('credits'):
            result['credits'].pop(); result['creditDetailsTruncated'] = True
        elif len(result['windows']) > 1:
            result['windows'].pop()
        else: break
    return result

def collect(accounts):
    panes = herdr('pane', 'list')['panes']
    output = {}
    now = time.time()
    active_claude = set()
    for pane in panes[:128]:
        pane_id = pane['pane_id']
        try:
            info = herdr('pane', 'process-info', '--pane', pane_id)['process_info']
            matches = [p for process in info.get('foreground_processes', [])
                       if (p := process_profile(process, pane_id))]
            if len(matches) != 1:
                continue
            provider, home, pid = matches[0]
            if provider == 'codex':
                cached = accounts.get(home, {})
                override = CACHE / ('reset-result-' + hashlib.sha256(home.encode()).hexdigest() + '.json')
                try:
                    fd = os.open(override, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(fd) as stream:
                        metadata = os.fstat(stream.fileno())
                        if metadata.st_uid != os.getuid() or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 128000:
                            raise ValueError('Invalid quota result')
                        fresh = json.load(stream)
                    if fresh.get('observedAt', 0) > cached.get('observedAt', 0):
                        cached = {**fresh, 'checkedAt': fresh['observedAt'] if fresh.get('status') == 'ok' else 0}
                        accounts[home] = cached
                except (OSError, ValueError, KeyError):
                    pass
                if now - cached.get('checkedAt', 0) >= 300 or 'credits' not in cached:
                    try:
                        cached = {**read_codex(home), 'observedAt': time.time()}
                    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError):
                        cached = {'windows': [], 'credits': [], 'bankedResets': None, 'accountKey': None,
                                  **cached, 'status': 'Quota refresh failed'}
                    cached['checkedAt'] = time.time()
                    accounts[home] = cached
                value = {**cached, 'profile': PROFILES[home]}
            else:
                start_time = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19]
                path = claude_cache_path(pid, start_time)
                active_claude.add(path)
                legacy = CACHE / ('claude-' + hashlib.sha256(pane_id.encode()).hexdigest()[:20] + '.json')
                path = path if path.exists() else legacy
                value = json.loads(path.read_text()) if path.exists() else {}
                if value.get('pid') != pid or value.get('processStart', start_time) != start_time:
                    value = {'status': 'Waiting for Claude status line', 'windows': []}
                value['profile'] = 'Default Claude'
            output[pane_id] = bounded_quota({**value, 'provider': provider})
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            continue
    atomic_json(CACHE / 'status.json', {'updatedAt': time.time(), 'panes': output})
    # Process-lifetime keys follow pane moves without accumulating history.
    inactive = sorted((p for p in CACHE.glob('claude-process-*.json') if p not in active_claude),
                      key=lambda p: p.stat().st_mtime, reverse=True)
    for path in inactive[max(0, 128 - len(active_claude)):]:
        path.unlink(missing_ok=True)

def claude_statusline(session='work'):
    import sys
    # The status-line input is not saved; only quota windows and identity are retained.
    data = json.loads(sys.stdin.buffer.read(1024 * 1024))
    pane = os.environ.get('HERDR_PANE_ID', '')
    if (session not in ('work', 'default') or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane)
            or (os.environ.get('HERDR_SESSION') or 'default') != session):
        return
    pid = os.getppid()
    for _ in range(6):
        proc = Path('/proc') / str(pid)
        if proc.stat().st_uid != os.getuid():
            return
        if (proc / 'comm').read_text().strip() == 'claude':
            break
        pid = int((proc / 'stat').read_text().rsplit(')', 1)[1].split()[1])
    else:
        return
    windows = claude_windows(data)
    start_time = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    path = claude_cache_path(pid, start_time)
    atomic_json(path, {'pid': pid, 'provider': 'claude', 'account': 'Claude · current session',
                      'processStart': start_time,
                      'windows': windows, 'observedAt': time.time(),
                      'status': 'ok' if windows else 'Quota not reported yet'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--claude-statusline', action='store_true')
    parser.add_argument('--claude-session', choices=('work', 'default'), default='work')
    args = parser.parse_args()
    os.umask(0o077)
    if args.claude_statusline:
        try:
            claude_statusline(args.claude_session)
        except (OSError, ValueError, KeyError):
            pass
    else:
        try:
            accounts = json.loads((CACHE / 'accounts.json').read_text())
        except (OSError, ValueError):
            accounts = {}
        while True:
            try:
                collect(accounts)
                atomic_json(CACHE / 'accounts.json', accounts)
            except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                print('Quota collection unavailable; previous data will be marked stale.', flush=True)
            if args.once:
                break
            time.sleep(30)
