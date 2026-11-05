#!/usr/bin/env python3
"""Read-only pane-to-Codex observer. Exports conversation messages and one bounded transient activity preview."""
import argparse
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import uuid
from activity import Activity
import claude
from transcript import open_transcript, transcript_info
from daemon_mapping import pane_info, match_daemon_thread, match_client_thread, foreground_claude_pane

SESSION = os.environ.get('HERDR_CONVERSATION_SESSION', 'work')
if SESSION not in ('work', 'default'):
    raise ValueError('Unsupported Herdr conversation session')
HOME = Path.home()
BASE = Path(os.environ.get('PASSEL_STATE_DIR', HOME / 'containers/herdr-web'))
CACHE = BASE / 'conversation-cache'
ROOTS = [HOME / '.codex/sessions', HOME / 'work/danus/runtime/codex-home/sessions',
         HOME / 'work/danus-mine/runtime/codex-home/sessions']
MAX_LINE = 2 * 1024 * 1024
TAIL = 16 * 1024 * 1024
MAX_MESSAGES = 300
MAX_CHARS = 500_000
PANE = re.compile(r'[A-Za-z0-9:._-]{1,100}')


def display_message(event, offset):
    if event.get('type') in ('user', 'assistant', 'queue-operation'):
        return claude.display_message(event, offset)
    # Canonical response items only: event_msg may duplicate the same text.
    item = event.get('payload', {})
    if event.get('type') != 'response_item' or item.get('type') != 'message':
        return None
    role = item.get('role')
    if role not in ('assistant', 'user'):
        return None
    if item.get('phase') not in (None, 'commentary', 'final', 'final_answer') or item.get('channel') not in (None, 'commentary', 'final'):
        return None
    content = item.get('content', [])
    text = '\n'.join(c['text'] for c in content if isinstance(c, dict)
                     and c.get('type') in ('input_text', 'output_text') and isinstance(c.get('text'), str))
    if not text.strip():
        return None
    # Known CLI-injected context is encoded as user text, not human input.
    if role == 'user' and text.lstrip().startswith(('# AGENTS.md instructions', '<environment_context>',
            '<environment ', '<permissions instructions>', '<turn_aborted>', '<subagent_notification>',
            '<collaboration_mode>', '<user_instructions>', '<codex_internal_context',
            '<system_reminder>', '<system-reminder>', '<skills_instructions>', '<developer_instructions>', 'You are performing a CONTEXT CHECKPOINT',
            'A previous language model', 'Another language model', 'You have hit the token limit')):
        return None
    return {'id': str(offset), 'role': role, 'text': text[:64_000],
            'truncated': len(text) > 64_000, 'timestamp': event.get('timestamp')}


class Reader:
    def __init__(self, path):
        self.path = path
        self.identity = None
        self.offset = 0
        self.messages = deque()
        self.earlier = False
        self.activity = Activity()

    def update(self):
        with open_transcript(self.path) as f:
            info = transcript_info(f)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                raise ValueError('Not an owned regular session')
            identity = (info.st_dev, info.st_ino)
            if identity != self.identity or info.st_size < self.offset:
                self.identity = identity
                self.messages.clear()
                self.activity = Activity()
                self.offset = max(0, info.st_size - TAIL)
                self.earlier = self.offset > 0
                f.seek(self.offset)
                if self.offset:
                    f.readline(MAX_LINE + 1)
                    # Oversized records are skipped by the loop below as well.
                    self.offset = f.tell()
            f.seek(self.offset)
            budget_end = self.offset + TAIL
            while f.tell() < min(info.st_size, budget_end):
                start = f.tell()
                line = f.readline(MAX_LINE + 1)
                if not line.endswith(b'\n'):
                    if len(line) <= MAX_LINE:
                        break  # A partial last record is retried on the next poll.
                    while line and not line.endswith(b'\n'):
                        line = f.readline(MAX_LINE + 1)
                    self.offset = f.tell()
                    continue
                self.offset = f.tell()
                if len(line) > MAX_LINE:
                    continue
                try:
                    event = json.loads(line)
                    self.activity.update(event)
                    message = display_message(event, start)
                except (ValueError, TypeError, AttributeError):
                    continue
                if message:
                    self.messages.append(message)
            chars = sum(len(m['text']) for m in self.messages)
            while len(self.messages) > MAX_MESSAGES or chars > MAX_CHARS:
                chars -= len(self.messages.popleft()['text'])
                self.earlier = True
        return list(self.messages)


def resumed_codex_thread(args):
    """Read an explicit resume ID after recognized global CLI options only."""
    value_options = {b'-c', b'--config', b'-p', b'--profile', b'-C', b'--cd',
                     b'-m', b'--model', b'-s', b'--sandbox', b'-a', b'--ask-for-approval',
                     b'--enable', b'--disable', b'-i', b'--image'}
    switches = {b'--no-alt-screen', b'--search', b'--full-auto',
                b'--dangerously-bypass-approvals-and-sandbox'}
    index = 1
    while index < len(args):
        arg = args[index]
        if arg in value_options:
            if index + 1 >= len(args) or not args[index + 1]:
                return None
            index += 2
        elif arg in switches or (b'=' in arg and arg.split(b'=', 1)[0] in value_options):
            index += 1
        else:
            if (arg == b'resume' and index + 1 < len(args)
                    and re.fullmatch(rb'[a-f0-9-]{36}', args[index + 1])):
                return args[index + 1].decode()
            return None
    return None


def main_session(paths, roots=ROOTS, resumed_thread=None):
    candidates = {}
    for path in set(paths):
        try:
            p = Path(path)
            if not any(p.is_relative_to(root) for root in roots) or p.suffix != '.jsonl':
                continue
            if p.resolve() != p:  # Do not follow aliases out of approved session roots.
                continue
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as f:
                info = os.fstat(f.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
                    continue
                meta = json.loads(f.readline(MAX_LINE)).get('payload', {})
            eligible_source = (meta.get('source') == 'cli'
                               or (resumed_thread is not None and meta.get('source') == 'vscode'))
            if (eligible_source and isinstance(meta.get('id'), str)
                    and (resumed_thread is None or meta['id'] == resumed_thread)):
                candidates[str(p)] = meta['id']
        except (OSError, ValueError):
            continue
    # VS Code history is eligible only when the live TUI explicitly resumes that
    # exact ID. Never guess between main threads or select a guardian/worker.
    return next(iter(candidates.items())) if len(candidates) == 1 else None


def process_session(pane, pid, start_time, paths, resumed_thread=None):
    transcripts = [p for p in paths if '/sessions/' in p and p.endswith('.jsonl')]
    if transcripts:
        # Existing but unsupported/ambiguous files must not become an empty session.
        return main_session(transcripts, resumed_thread=resumed_thread)
    # Codex creates its rollout lazily after the first message. Bind the temporary
    # conversation to this exact process lifetime, not just a reusable pane/PID.
    identity = f'herdr-conversation:{os.getuid()}:{SESSION}:{pane}:{pid}:{start_time}'
    return None, str(uuid.uuid5(uuid.NAMESPACE_URL, identity))


def foreground_terminal_start(stat_text):
    # /proc/PID/stat fields after comm: state, ppid, pgrp, session, tty_nr,
    # tpgid, ... starttime. Helpers inherit HERDR_PANE_ID and even comm=codex,
    # but sandbox/app-server processes have no controlling terminal.
    fields = stat_text.rsplit(')', 1)[1].split()
    if len(fields) < 20 or int(fields[4]) == 0 or int(fields[5]) <= 0:
        return None
    if int(fields[2]) != int(fields[5]):
        return None
    return fields[19]


# Last proven attachment, bound to this exact foreground process lifetime.
# Used only while a live choice screen temporarily replaces its normal caption.
ATTACHMENTS = {}


def match_blocked_thread(profile, info, paths, resumed_thread, previous, terminal_text):
    from choices import choice_screen
    match = match_daemon_thread(profile, info, paths, resumed_thread)
    if match:
        return match
    if previous and choice_screen(info, terminal_text):
        pinned = {**info, 'agent': 'codex', 'terminal_title_stripped': previous['caption']}
        match = match_daemon_thread(profile, pinned, paths, resumed_thread)
        if match and match[1] == previous['thread']:
            return match
    return None


def foreground_codex_client(pane, pid, request=None):
    if request is None:
        from replies import api_request
        request = api_request
    process = request('pane.process_info', {'pane_id': pane})['process_info']
    return process.get('pane_id') == pane and any(p.get('pid') == int(pid) and p.get('name') == 'codex'
                                                 for p in process.get('foreground_processes', []))


def initial_codex_client(pane, pid, info, args, request=None):
    """Prove a blank, new foreground TUI before allowing its first reply."""
    if (not info or info.get('agent') != 'codex' or info.get('agent_status') != 'idle'
            or info.get('agent_session') or not isinstance(info.get('foreground_cwd'), str)
            or info.get('terminal_title_stripped') != Path(info['foreground_cwd']).name
            or any(arg in (b'resume', b'fork', b'exec', b'app-server') for arg in args)):
        return False
    if request is None:
        from replies import api_request
        request = api_request
    if not foreground_codex_client(pane, pid, request):
        return False
    text = request('pane.read', {'pane_id': pane, 'source': 'detection', 'lines': 80,
                                 'format': 'text', 'strip_ansi': True})['read']['text'][-12000:]
    return bool(re.search(r'(?m)^\s*>_ OpenAI Codex\s+\(v[^\n)]+\)', text)
                and re.search(r'(?m)^\s*[›»]\s+Ask Codex to do\s+anything\s*$', text))


def discover():
    panes = {}
    clients = []
    daemon_paths = {}
    for proc in Path('/proc').iterdir():
        try:
            if not proc.name.isdigit() or proc.stat().st_uid != os.getuid():
                continue
            comm = (proc / 'comm').read_text().strip()
            if comm not in ('codex', 'claude'):
                continue
            fields = {}
            for entry in (proc / 'environ').read_bytes().split(b'\0'):
                key, _, value = entry.partition(b'=')
                if key in (b'HERDR_PANE_ID', b'HERDR_SESSION', b'CODEX_HOME', b'CLAUDE_CONFIG_DIR'):
                    fields[key] = value.decode()
            if comm == 'claude':
                pane = fields.get(b'HERDR_PANE_ID', '')
                if not PANE.fullmatch(pane) or (fields.get(b'HERDR_SESSION') or 'default') != SESSION:
                    continue
                profile = fields.get(b'CLAUDE_CONFIG_DIR', str(HOME / '.claude'))
                if profile != str(HOME / '.claude'):
                    continue
                start_time = foreground_terminal_start((proc / 'stat').read_text())
                if start_time is None:
                    continue
                match = claude.match_session(profile, proc.name, start_time, os.readlink(proc / 'cwd'))
                current = foreground_claude_pane(pane, int(proc.name), start_time, SESSION) if match else None
                if current and foreground_terminal_start((proc / 'stat').read_text()) == start_time:
                    panes.setdefault(current, []).append(match)
                continue
            profile = fields.get(b'CODEX_HOME', str(HOME / '.codex'))
            if profile not in {str(root.parent) for root in ROOTS}:
                continue
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if b'app-server' in args and b'--managed-daemon' in args:
                paths = daemon_paths.setdefault(profile, set())
                for fd in (proc / 'fd').iterdir():
                    try:
                        path = os.readlink(fd)
                        if (path.endswith('.jsonl') and '/sessions/' in path) or ('/thread-writer-locks/' in path and path.endswith('.lock')):
                            paths.add(path)
                    except OSError:
                        pass
                continue
            pane = fields.get(b'HERDR_PANE_ID', '')
            if not PANE.fullmatch(pane) or (fields.get(b'HERDR_SESSION') or 'default') != SESSION:
                continue
            profile = fields.get(b'CODEX_HOME', str(HOME / '.codex'))
            if profile not in {str(root.parent) for root in ROOTS}:
                continue
            start_time = foreground_terminal_start((proc / 'stat').read_text())
            if start_time is None:
                continue
            paths = []
            for fd in (proc / 'fd').iterdir():
                try:
                    paths.append(os.readlink(fd))
                except OSError:
                    pass
            resumed_thread = resumed_codex_thread(args)
            clients.append((pane, proc, start_time, profile, paths, resumed_thread, args))
        except (OSError, ValueError):
            continue
    live_bindings = set()
    for pane, proc, start_time, profile, paths, resumed_thread, args in clients:
        try:
            transcripts = [p for p in paths if '/sessions/' in p and p.endswith('.jsonl')]
            if not transcripts and profile in daemon_paths:
                info = pane_info(pane, SESSION)
                binding = (pane, proc.name, start_time, profile)
                live_bindings.add(binding)
                match = match_daemon_thread(profile, info, daemon_paths[profile], resumed_thread)
                if match:
                    ATTACHMENTS[binding] = {'caption': info['terminal_title_stripped'], 'thread': match[1]}
                elif info and binding in ATTACHMENTS:
                    from replies import api_request, ReplyError
                    try:
                        text = api_request('pane.read', {'pane_id': pane, 'source': 'detection', 'lines': 80,
                                                        'format': 'text', 'strip_ansi': True})['read']['text']
                    except ReplyError:
                        text = ''
                    match = match_blocked_thread(profile, info, daemon_paths[profile], resumed_thread,
                                                 ATTACHMENTS[binding], text)
                if not match:
                    match, indexed = match_client_thread(profile, info, paths, resumed_thread)
                    if match and not foreground_codex_client(pane, proc.name):
                        match = None
                    if not match and not indexed and initial_codex_client(pane, proc.name, info, args):
                        match = process_session(pane, proc.name, start_time, paths, resumed_thread)
            else:
                match = process_session(pane, proc.name, start_time, paths, resumed_thread)
            if foreground_terminal_start((proc / 'stat').read_text()) != start_time:
                continue
            if match:
                panes.setdefault(pane, []).append(match)
        except (OSError, ValueError):
            continue
    for binding in list(ATTACHMENTS):
        if binding not in live_bindings:
            ATTACHMENTS.pop(binding, None)
    return {pane: matches[0] for pane, matches in panes.items() if len(matches) == 1}


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as f:
        json.dump(value, f, ensure_ascii=False)
    temp.replace(path)


def collect(readers):
    mappings = discover()
    active = set()
    for pane, (path, session) in mappings.items():
        key = hashlib.sha256(pane.encode()).hexdigest()
        active.add(key + '.json')
        try:
            reader = readers.setdefault(path, Reader(path)) if path is not None else None
            if reader:
                reader.path = path  # Same logical root may now include a new continuation.
            messages = reader.update() if reader else []
            atomic_json(CACHE / (key + '.json'), {'session': session, 'observedAt': time.time(),
                        'messages': messages, 'earlier': reader.earlier if reader else False,
                        'awaitingFirstMessage': reader is None,
                        'activity': reader.activity.current if reader else None,
                        'turnActive': reader.activity.turn_active if reader else None})
        except (OSError, ValueError):
            pass  # Existing cache expires; no fallback to another session.
    for path in CACHE.glob('*.json'):
        if path.name not in active:
            path.unlink()
    current_paths = {m[0] for m in mappings.values()}
    for path in list(readers):
        if path not in current_paths:
            del readers[path]


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    # Bound the host observer independently of browser history limits.
    import resource
    # Keep this observer capped, but retain the inherited hard limit so the
    # explicitly launched account client can restore its own address-space limit.
    hard = resource.getrlimit(resource.RLIMIT_AS)[1]
    soft = 256 * 1024 * 1024 if hard == resource.RLIM_INFINITY else min(256 * 1024 * 1024, hard)
    resource.setrlimit(resource.RLIMIT_AS, (soft, hard))
    CACHE.mkdir(mode=0o700, exist_ok=True)
    if not args.once:
        from replies import start_reply_server
        start_reply_server(CACHE / 'reply.sock', discover)
    readers = {}
    while True:
        try:
            collect(readers)
        except (OSError, ValueError):
            print('Conversation observation unavailable.', flush=True)
        if args.once:
            break
        time.sleep(3)
