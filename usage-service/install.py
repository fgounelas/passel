#!/usr/bin/env python3
"""Install only this user's collector cron and non-destructive Claude status hook."""
import argparse
import shlex
import json
import os
from pathlib import Path
import subprocess
from collector import BASE, CACHE, QUOTA_SOCKET, atomic_json

parser = argparse.ArgumentParser()
parser.add_argument('--codex-only', action='store_true', help='Install quota polling without changing Claude settings')
parser.add_argument('--claude-session', choices=('work', 'default'),
                    default='default' if QUOTA_SOCKET == str(Path.home() / '.config/herdr/herdr.sock') else 'work')
args = parser.parse_args()
os.umask(0o077)
CACHE.mkdir(mode=0o700, exist_ok=True)
rollback = BASE / 'usage-rollback'
rollback.mkdir(mode=0o700, exist_ok=True)
result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if result.returncode and 'no crontab' not in result.stderr.lower():
    raise SystemExit('Cannot read existing crontab')
old = result.stdout
saved = rollback / 'crontab.txt'
if not saved.exists():
    saved.write_text(old)
marker = '# herdr-web quota observer'
lines = [line for line in old.splitlines() if marker not in line]
socket_env = f'HERDR_QUOTA_SOCKET={shlex.quote(QUOTA_SOCKET)} ' if QUOTA_SOCKET else ''
lines.append(f'* * * * * {socket_env}/usr/bin/flock -n {CACHE}/collector.lock /usr/bin/python3 -B {BASE}/usage-service/collector.py --once >/dev/null 2>&1 {marker}')
subprocess.run(['crontab', '-'], input='\n'.join(lines) + '\n', text=True, check=True)
if args.codex_only:
    print('Installed per-user Codex quota cron; Claude settings unchanged.')
    raise SystemExit(0)
settings = Path.home() / '.claude/settings.json'
config = json.loads(settings.read_text()) if settings.exists() else {}
old_hook = f'/usr/bin/python3 -B {BASE}/usage-service/collector.py --claude-statusline'
hook = f'{old_hook} --claude-session {args.claude_session}'
current = config.get('statusLine')
if current and current.get('command') not in (old_hook, hook):
    raise SystemExit('Existing Claude status line preserved; manual wrapping required')
backup = rollback / 'claude-settings.json'
if not backup.exists():
    atomic_json(backup, config)
config['statusLine'] = {'type': 'command', 'command': hook}
atomic_json(settings, config)
print('Installed per-user quota cron and Claude status-line observer; rollback files retained privately.')
