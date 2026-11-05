"""Claude CLI identity and canonical text; never infer sessions from recency."""
import json
import hashlib
from functools import lru_cache
import os
from pathlib import Path
import re
import stat
from transcript import TranscriptPath

UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')


def owned_file(path):
    path = Path(path)
    if path.resolve() != path:
        raise ValueError('Aliased Claude metadata')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    stream = os.fdopen(fd, 'rb')
    info = os.fstat(stream.fileno())
    if info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode):
        stream.close()
        raise ValueError('Not an owned regular file')
    return stream


def match_session(profile, pid, start_time, cwd):
    """Registry binds UUID to PID lifetime; foreground/session checks are external."""
    profile = Path(profile)
    try:
        with owned_file(profile / 'sessions' / f'{pid}.json') as stream:
            raw = stream.read(64_001)
            if len(raw) > 64_000:
                return None
            data = json.loads(raw)
        if (data.get('pid') != int(pid) or data.get('procStart') != start_time
                or data.get('cwd') != cwd or data.get('kind') != 'interactive'
                or data.get('entrypoint') != 'cli'):
            return None
        session = data.get('sessionId')
        if not isinstance(session, str) or not UUID.fullmatch(session):
            return None
        project = re.sub(r'[^a-zA-Z0-9]', '-', cwd)
        path = profile / 'projects' / project / (session + '.jsonl')
        # A validated live interactive session has no transcript until its first
        # message. Do not manufacture history or confuse it with an unsupported pane.
        if not path.exists() and not path.is_symlink():
            return None, session
        # Validate transcript identity independently. Never select subagent logs.
        with owned_file(path) as stream:
            for _ in range(64):
                line = stream.readline(2 * 1024 * 1024 + 1)
                if not line or len(line) > 2 * 1024 * 1024:
                    break
                event = json.loads(line)
                if event.get('type') in ('user', 'assistant'):
                    if (event.get('sessionId') == session and event.get('cwd') == cwd
                            and event.get('isSidechain') is False):
                        return resolve_continuations(path, session, cwd), session
                    return None
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return None


def display_message(event, offset):
    if event.get('type') == 'queue-operation':
        # Claude can deliver a prompt into an active turn without writing a
        # normal user record. Enqueues alone are not evidence of delivery.
        if (event.get('operation') != 'remove' or event.get('reason') != 'absorbed_mid_turn'
                or not isinstance(event.get('content'), str)
                or any(not isinstance(event.get(key), str) or not UUID.fullmatch(event[key])
                       for key in ('sessionId', 'commandUuid', 'deliveryId'))):
            return None
        event = {**event, 'type': 'user', 'message': {'role': 'user', 'content': event['content']}}
    role = event.get('type')
    if (role not in ('user', 'assistant') or event.get('isSidechain')
            or event.get('isMeta') or event.get('isCompactSummary')):
        return None
    message = event.get('message', {})
    if not isinstance(message, dict) or message.get('role') != role:
        return None
    content = message.get('content', [])
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        fields = {'text': 'text'}
        # Claude's visible progress updates use thinking blocks, with an explicit
        # display marker on the assistant record. Unmarked/private thinking and
        # other display modes remain excluded.
        if role == 'assistant' and event.get('thinkingDisplay') == 'updates':
            fields['thinking'] = 'thinking'
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            kind = block.get('type')
            field = fields.get(kind) if isinstance(kind, str) else None
            value = block.get(field) if field else None
            if isinstance(value, str):
                parts.append(value)
        text = '\n'.join(parts)
    else:
        return None
    if not text.strip():
        return None
    if role == 'user' and text.lstrip().startswith(('<local-command-', '<command-name>', '<command-message>',
            '<system-reminder>', '<task-notification>', '<agent-message', 'Another Claude session sent a message:', '[Request interrupted by user',
            'This session is being continued from a previous conversation')):
        return None
    return {'id': str(offset), 'role': role, 'text': text[:64_000],
            'truncated': len(text) > 64_000, 'timestamp': event.get('timestamp')}


MAX_RECORD = 2 * 1024 * 1024
MAX_SCAN = 16 * 1024 * 1024


def _signature(event):
    return hashlib.sha256(json.dumps(event.get('message'), sort_keys=True,
                                     ensure_ascii=False).encode()).digest()


def _first_main(stream, session, cwd):
    stream.seek(0)
    for _ in range(64):
        line = stream.readline(MAX_RECORD + 1)
        if not line or len(line) > MAX_RECORD:
            break
        event = json.loads(line)
        if event.get('type') in ('user', 'assistant'):
            if (event.get('sessionId') != session or event.get('cwd') != cwd
                    or event.get('isSidechain') is not False
                    or not UUID.fullmatch(event.get('uuid', ''))):
                raise ValueError('Invalid main continuation identity')
            return event['uuid'], _signature(event)
    raise ValueError('No main continuation identity')


@lru_cache(maxsize=128)
def _transition(path, identity):
    # Cache metadata only, never conversation text. Append/replace invalidates it.
    last = None
    link = None
    with owned_file(path) as stream:
        info = os.fstat(stream.fileno())
        start = max(0, info.st_size - MAX_SCAN)
        stream.seek(start)
        if start:
            stream.readline(MAX_RECORD + 1)
        while stream.tell() < info.st_size:
            line = stream.readline(MAX_RECORD + 1)
            if not line.endswith(b'\n'):
                if len(line) <= MAX_RECORD:
                    break
                while line and not line.endswith(b'\n'):
                    line = stream.readline(MAX_RECORD + 1)
                continue
            if len(line) > MAX_RECORD:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('type') in ('user', 'assistant') and event.get('isSidechain') is False:
                message_id = event.get('uuid')
                if isinstance(message_id, str) and UUID.fullmatch(message_id):
                    last = (message_id, _signature(event))
                    link = None  # New main messages supersede an earlier handoff.
            elif event.get('type') == 'continued-in':
                child = event.get('continuedInSessionId')
                if (event.get('sessionId') != Path(path).stem
                        or not isinstance(child, str) or not UUID.fullmatch(child) or not last):
                    raise ValueError('Invalid transcript continuation')
                link = (child, stream.tell(), *last)
    return link


@lru_cache(maxsize=128)
def _copied_anchor(path, identity, session, cwd, first, last):
    with owned_file(path) as stream:
        if _first_main(stream, session, cwd) != first:
            raise ValueError('Continuation did not copy its main conversation')
        stream.seek(0)
        budget = min(os.fstat(stream.fileno()).st_size, MAX_SCAN)
        while stream.tell() < budget:
            offset = stream.tell()
            line = stream.readline(min(MAX_RECORD + 1, budget - offset))
            if not line.endswith(b'\n'):
                if len(line) <= MAX_RECORD:
                    break
                while stream.tell() < budget and line and not line.endswith(b'\n'):
                    line = stream.readline(min(MAX_RECORD + 1, budget - stream.tell()))
                continue
            if len(line) > MAX_RECORD:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('uuid') == last[0]:
                if (event.get('sessionId') != session or event.get('isSidechain') is not False
                        or _signature(event) != last[1]):
                    raise ValueError('Mismatched continuation anchor')
                return offset, stream.tell()
    raise ValueError('Continuation anchor is unavailable within scan bound')


def resolve_continuations(path, session, cwd):
    root = str(path)
    segments = []
    seen = set()
    start = 0
    current_session = session
    with owned_file(path) as stream:
        info = os.fstat(stream.fileno())
        # Ordinary transcripts need no new UUID requirement or logical stream.
        link = _transition(str(path), (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns))
        if link is None:
            return root
        first = _first_main(stream, session, cwd)
    for _ in range(8):
        if current_session in seen:
            raise ValueError('Cyclic conversation continuation')
        seen.add(current_session)
        with owned_file(path) as stream:
            info = os.fstat(stream.fileno())
            link = _transition(str(path), (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns))
            if link is None:
                segments.append((str(path), start, info.st_size, info.st_dev, info.st_ino))
                return TranscriptPath(root, segments, current_session)
            child, end, last_id, last_digest = link
            if not start <= end <= info.st_size or child in seen:
                raise ValueError('Invalid continuation chain')
            segments.append((str(path), start, end, info.st_dev, info.st_ino))
        target = path.parent / (child + '.jsonl')
        with owned_file(target) as stream:
            info = os.fstat(stream.fileno())
            if _first_main(stream, child, cwd) != first:
                raise ValueError('Invalid copied main conversation')
            anchor, after = _copied_anchor(str(target), (info.st_dev, info.st_ino), child, cwd,
                                            first, (last_id, last_digest))
            if after > info.st_size:
                raise ValueError('Continuation was truncated')
            stream.seek(anchor)
            event = json.loads(stream.readline(MAX_RECORD + 1))
            if (event.get('uuid') != last_id or event.get('sessionId') != child
                    or event.get('isSidechain') is not False or _signature(event) != last_digest):
                raise ValueError('Continuation anchor changed')
        path, start, current_session = target, after, child
    raise ValueError('Conversation continuation depth exceeded')
