"""Durable tab visibility and explicit, narrowly scoped agent quit/resume actions."""
import json
import re
import time
from bookmarks import Bookmarks
from replies import ReplyError, api_request


def tab_identity(snapshot, tab):
    """Persisted public pane IDs/cwds survive replacement of terminal processes."""
    info = next((t for t in snapshot['tabs'] if t['tab_id'] == tab), None)
    panes = [p for p in snapshot['panes'] if p['tab_id'] == tab]
    if (not info or not isinstance(info.get('workspace_id'), str) or not panes
            or any(not isinstance(p.get('pane_id'), str) or not isinstance(p.get('cwd'), str)
                   or not p['cwd'].startswith('/') for p in panes)):
        return None
    return json.dumps([info['workspace_id'], sorted([p['pane_id'], p['cwd']] for p in panes)])


class Archives(Bookmarks):
    def __init__(self, path):
        super().__init__(path)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS stopped_tabs (tab TEXT PRIMARY KEY, terminal TEXT NOT NULL, resume TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS archived_tabs '
                       '(tab TEXT PRIMARY KEY, terminals TEXT NOT NULL, created INTEGER NOT NULL)')
            for table in ('stopped_tabs', 'archived_tabs'):
                if 'identity' not in {r[1] for r in db.execute('PRAGMA table_info(' + table + ')')}:
                    db.execute('ALTER TABLE ' + table + ' ADD COLUMN identity TEXT')

    def request(self, body, discover=lambda: {}, request=api_request):
        action = body.get('action')
        if action not in ('list', 'archive', 'restore', 'quit', 'resume'):
            raise ReplyError(400, 'Unsupported archive action. Archiving does not stop sessions or workers.')
        expected = {'operation', 'action'} if action == 'list' else {'operation', 'action', 'tab'}
        if set(body) != expected:
            raise ReplyError(400, 'Invalid archive request.')
        if action != 'list' and (not isinstance(body['tab'], str) or
                                not re.fullmatch(r'[A-Za-z0-9:._-]{1,100}', body['tab'])):
            raise ReplyError(400, 'Invalid tab.')
        snapshot = request('session.snapshot', {})['snapshot']
        tabs = {t['tab_id'] for t in snapshot['tabs']}
        terminals = {tab: sorted(p['terminal_id'] for p in snapshot['panes'] if p['tab_id'] == tab)
                     for tab in tabs}
        identities = {tab: tab_identity(snapshot, tab) for tab in tabs}
        def matches(tab, identity, previous):
            if tab not in tabs:
                return False
            return (identity == identities[tab] if identity is not None
                    else bool(set(previous).intersection(terminals[tab])))
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            # Never delete durable state on a read: restart/transient snapshots
            # can replace terminal IDs or temporarily omit tabs. Unmatched rows
            # remain recoverable but cannot hide or resume an unrelated tab.
            for tab, terminal, identity in db.execute('SELECT tab,terminal,identity FROM stopped_tabs').fetchall():
                if matches(tab, identity, [terminal]) and identity is None and identities[tab] is not None:
                    db.execute('UPDATE stopped_tabs SET identity=? WHERE tab=?', (identities[tab], tab))
            for tab, previous, identity in db.execute('SELECT tab,terminals,identity FROM archived_tabs').fetchall():
                if matches(tab, identity, json.loads(previous)) and identity is None and identities[tab] is not None:
                    db.execute('UPDATE archived_tabs SET identity=? WHERE tab=?', (identities[tab], tab))
            if action in ('archive', 'quit'):
                tab = body['tab']
                if tab not in tabs or not terminals[tab]:
                    raise ReplyError(409, 'This tab is no longer available. Refresh and try again.')
                if db.execute('SELECT count(*) FROM archived_tabs').fetchone()[0] >= 1000:
                    raise ReplyError(409, 'Archive is full. Restore a tab first.')
                if action == 'quit':
                    panes = [p for p in snapshot['panes'] if p['tab_id'] == tab]
                    if len(panes) != 1:
                        raise ReplyError(409, 'Quit and archive is available for single-pane supported agent tabs only.')
                    from tab_lifecycle import quit_session
                    saved = quit_session(panes[0]['pane_id'], discover, request)
                    if saved:
                        db.execute('INSERT OR REPLACE INTO stopped_tabs (tab,terminal,resume,identity) VALUES (?,?,?,?)',
                                   (tab, panes[0]['terminal_id'], json.dumps(saved), identities[tab]))
                db.execute('INSERT INTO archived_tabs (tab,terminals,created,identity) VALUES (?,?,?,?) '
                           'ON CONFLICT(tab) DO UPDATE SET terminals=excluded.terminals,identity=excluded.identity',
                           (tab, json.dumps(terminals[tab]), time.time_ns(), identities[tab]))
            elif action == 'restore':
                db.execute('DELETE FROM archived_tabs WHERE tab=?', (body['tab'],))
            elif action == 'resume':
                row = db.execute('SELECT resume,terminal,identity FROM stopped_tabs WHERE tab=?', (body['tab'],)).fetchone()
                if not row or not matches(body['tab'], row[2], [row[1]]):
                    raise ReplyError(409, 'No saved session is available to resume.')
                from tab_lifecycle import resume_session
                resume_session(json.loads(row[0]), request)
                db.execute('DELETE FROM stopped_tabs WHERE tab=?', (body['tab'],))
                db.execute('DELETE FROM archived_tabs WHERE tab=?', (body['tab'],))
            # Forget the saved launch if the user has already manually reattached a conversation.
            stopped = db.execute('SELECT tab,resume,terminal,identity FROM stopped_tabs').fetchall()
            if action == 'list' and stopped:
                attached = discover()
                for tab, value, terminal, identity in stopped:
                    saved = json.loads(value)
                    current = attached.get(saved['pane'])
                    if (matches(tab, identity, [terminal]) and current
                            and (not saved.get('session') or current[1] == saved['session'])):
                        db.execute('DELETE FROM stopped_tabs WHERE tab=?', (tab,))
            return {'stopped': [tab for tab, terminal, identity in db.execute('SELECT tab,terminal,identity FROM stopped_tabs')
                                if matches(tab, identity, [terminal])],
                    'tabs': [tab for tab, previous, identity in db.execute('SELECT tab,terminals,identity FROM archived_tabs ORDER BY created')
                             if matches(tab, identity, json.loads(previous))]}
