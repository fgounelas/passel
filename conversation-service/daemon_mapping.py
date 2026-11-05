"""Conservative fallback for CLI clients whose rollout is held by a shared daemon.

Require an exact, unique persisted thread name matching Herdr's live terminal
caption and cwd, an open daemon rollout in the same approved profile, and TUI
origin metadata. Never infer identity from pane labels, recency, or inherited
HERDR_PANE_ID on the shared daemon.
"""
import json
import os
import re
from pathlib import Path
import socket
import sqlite3
import stat
from contextlib import closing


def pane_request(method, params, session):
    if method not in ('pane.get', 'pane.list', 'pane.process_info'):
        raise ValueError('Unsupported mapping query')
    path = Path.home() / ('.config/herdr/herdr.sock' if session == 'default'
                          else '.config/herdr/sessions/work/herdr.sock')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(2)
        conn.connect(str(path))
        conn.sendall((json.dumps({'id': 'passel-map', 'method': method,
                                 'params': params}) + '\n').encode())
        with conn.makefile('rb') as stream:
            line = stream.readline(256_001)
    if len(line) > 256_000 or not line.endswith(b'\n'):
        return None
    data = json.loads(line)
    if data.get('id') != 'passel-map' or 'error' in data:
        return None
    return data.get('result', {})


def pane_info(pane, session):
    result = pane_request('pane.get', {'pane_id': pane}, session)
    return result.get('pane') if result else None


CLAUDE_PANES = {}


def match_client_thread(profile, info, paths, resumed_thread=None):
    """Use only writer locks held by this foreground TUI, never shared-daemon locks.

    The second return value distinguishes unindexed startup locks from existing
    threads that could not be safely matched; those must not become new sessions.
    """
    if not info or info.get('agent') not in (None, 'codex') or not isinstance(info.get('foreground_cwd'), str):
        return None, True
    profile = Path(profile)
    locks = set()
    for filename in paths:
        path = Path(filename)
        if path.parent != profile / 'thread-writer-locks' or path.suffix != '.lock' or not re.fullmatch(r'[a-f0-9-]{36}', path.stem):
            continue
        try:
            metadata = path.lstat()
            if path.resolve() == path and stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.getuid():
                locks.add(path.stem)
        except OSError:
            pass
    if not locks:
        return None, False
    if len(locks) > 16:
        return None, True
    try:
        db = profile / 'state_5.sqlite'
        if db.resolve() != db or db.stat().st_uid != os.getuid() or not stat.S_ISREG(db.stat().st_mode):
            return None, True
        with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=0.2)) as conn:
            ticks = [0]
            def limit():
                ticks[0] += 1
                return ticks[0] > 1000
            conn.set_progress_handler(limit, 1000)
            rows = []
            for thread in locks:
                rows.extend(conn.execute('SELECT id,rollout_path,source,cwd,archived FROM threads WHERE id=? LIMIT 2', (thread,)).fetchall())
        candidates = []
        for thread, filename, source, cwd, archived in rows:
            if archived or cwd != info['foreground_cwd'] or source not in ('cli', 'vscode') or (source == 'vscode' and resumed_thread != thread):
                continue
            if resumed_thread is not None and thread != resumed_thread:
                continue
            path = Path(filename)
            if not path.is_relative_to(profile / 'sessions') or path.resolve() != path or path.suffix != '.jsonl':
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as stream:
                    metadata = os.fstat(stream.fileno())
                    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
                        continue
                    event = json.loads(stream.readline(2 * 1024 * 1024))
                meta = event.get('payload', {})
                if (event.get('type') == 'session_meta' and meta.get('id') == thread and meta.get('source') == source
                        and meta.get('originator') == 'codex-tui' and meta.get('thread_source') == 'user'
                        and (meta.get('cwd') == cwd or resumed_thread == thread)):
                    candidates.append((filename, thread))
            except (OSError, ValueError, TypeError):
                continue
        return (candidates[0] if len(candidates) == 1 else None), bool(rows)
    except (OSError, ValueError, sqlite3.Error, TypeError):
        return None, True


def foreground_claude_pane(inherited, pid, start_time, session, request=pane_request):
    """Bind a moved TUI to its current daemon pane, never its inherited old ID."""
    key = (session, pid, start_time)

    def owns(pane):
        if not isinstance(pane, str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', pane):
            return False
        result = request('pane.process_info', {'pane_id': pane}, session)
        info = (result or {}).get('process_info', {})
        return info.get('pane_id') == pane and any(
            process.get('pid') == pid and process.get('name') == 'claude'
            for process in info.get('foreground_processes', []))

    for pane in dict.fromkeys((CLAUDE_PANES.get(key), inherited)):
        if owns(pane):
            CLAUDE_PANES[key] = pane
            return pane
    CLAUDE_PANES.pop(key, None)
    result = request('pane.list', {}, session)
    panes = (result or {}).get('panes', [])
    if not isinstance(panes, list) or len(panes) > 128:
        return None
    matches = [pane['pane_id'] for pane in panes
               if isinstance(pane, dict) and pane.get('agent') == 'claude'
               and owns(pane.get('pane_id'))]
    if len(matches) != 1:
        return None
    if len(CLAUDE_PANES) >= 128:
        CLAUDE_PANES.clear()
    CLAUDE_PANES[key] = matches[0]
    return matches[0]


def match_daemon_thread(profile, info, paths, resumed_thread=None):
    if not info or info.get('agent') != 'codex':
        return None
    cwd = info.get('foreground_cwd')
    caption = info.get('terminal_title_stripped')
    if not isinstance(cwd, str) or not isinstance(caption, str):
        return None
    suffix = ' | ' + Path(cwd).name
    if not caption.endswith(suffix):
        return None
    name = caption[:-len(suffix)]
    if not name or len(name) > 1000:
        return None
    profile = Path(profile)
    db = profile / 'state_5.sqlite'
    try:
        if db.resolve() != db or db.stat().st_uid != os.getuid() or not stat.S_ISREG(db.stat().st_mode):
            return None
        with closing(sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=0.2)) as conn:
            # Bound scanning even if a future database has an incompatible layout.
            ticks = [0]
            def limit():
                ticks[0] += 1
                return ticks[0] > 1000
            conn.set_progress_handler(limit, 1000)
            # Resumed CLI threads retain their original source even when their
            # current writer is the shared app-server daemon.
            query = ('SELECT id, rollout_path, source FROM threads WHERE name=? AND cwd=? '
                     "AND source IN ('cli', 'vscode') AND archived=0 LIMIT 2")
            rows = conn.execute(query, (name, cwd)).fetchall()
            # Codex decorates the title while an input request is open. Keep
            # exact-name precedence; only remove this known status decoration
            # on blocked panes, then apply all normal identity/ownership checks.
            prefix = '[ ! ] Action Required | '
            if not rows and info.get('agent_status') == 'blocked' and name.startswith(prefix):
                rows = conn.execute(query, (name[len(prefix):], cwd)).fetchall()
        if len(rows) != 1:
            return None
        thread, filename, source = rows[0]
        path = Path(filename)
        lock = str(profile / 'thread-writer-locks' / (str(thread) + '.lock'))
        held = filename in paths or (re.fullmatch(r'[a-f0-9-]{36}', str(thread)) and lock in paths)
        if not held or not path.is_relative_to(profile / 'sessions') or path.resolve() != path:
            return None
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            st = os.fstat(stream.fileno())
            if st.st_uid != os.getuid() or not stat.S_ISREG(st.st_mode):
                return None
            meta = json.loads(stream.readline(2 * 1024 * 1024)).get('payload', {})
        if (meta.get('id') != thread or meta.get('source') != source
                or meta.get('originator') != 'codex-tui' or meta.get('thread_source') != 'user'
                # session_meta records the creation directory. A migrated
                # thread can have a different current DB/foreground directory;
                # accept that only with its exact live `codex resume UUID`.
                or (meta.get('cwd') != cwd and resumed_thread != thread)):
            return None
        return filename, thread
    except (OSError, ValueError, sqlite3.Error, TypeError):
        return None
