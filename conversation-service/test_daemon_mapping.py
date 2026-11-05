import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from daemon_mapping import match_daemon_thread, match_client_thread, foreground_claude_pane, CLAUDE_PANES


class DaemonMapping(unittest.TestCase):
    def client_fixture(self):
        thread = '00000000-0000-0000-0000-000000000065'
        self.meta.update(id=thread, source='cli')
        self.path.write_text(json.dumps({'type': 'session_meta', 'payload': self.meta}) + '\n')
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('UPDATE threads SET id=?,source=?', (thread, 'cli')); conn.commit()
        folder = self.root / 'thread-writer-locks'; folder.mkdir()
        lock = folder / (thread + '.lock'); lock.touch()
        return thread, lock

    def test_client_lock_maps_unnamed_thread_without_using_shared_daemon_activity(self):
        thread, lock = self.client_fixture()
        info = {**self.info, 'terminal_title_stripped': 'project'}
        self.assertEqual(match_client_thread(self.root, info, [str(lock)]), ((str(self.path), thread), True))
        self.assertEqual(match_client_thread(self.root, {**info, 'agent': None, 'agent_status': 'blocked'}, [str(lock)]),
                         ((str(self.path), thread), True))
        self.assertEqual(match_client_thread(self.root, info, []), (None, False))
        self.assertEqual(match_client_thread(self.root, info, [str(self.path)]), (None, False))
        self.assertEqual(match_client_thread(self.root, {**info, 'foreground_cwd': '/other'}, [str(lock)]), (None, True))

    def test_unindexed_locks_are_distinct_from_unsupported_or_ambiguous_existing_threads(self):
        thread, lock = self.client_fixture()
        for field, value in [('source', 'exec'), ('thread_source', 'subagent'), ('originator', 'worker'), ('id', 'other')]:
            meta = {**self.meta, field: value}
            self.path.write_text(json.dumps({'type': 'session_meta', 'payload': meta}) + '\n')
            self.assertEqual(match_client_thread(self.root, self.info, [str(lock)]), (None, True))
        self.path.write_text(json.dumps({'type': 'session_meta', 'payload': self.meta}) + '\n')
        second = '00000000-0000-0000-0000-000000000066'
        other = self.root / 'sessions/other.jsonl'
        other.write_text(json.dumps({'type': 'session_meta', 'payload': {**self.meta, 'id': second}}) + '\n')
        other_lock = lock.with_name(second + '.lock'); other_lock.touch()
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('INSERT INTO threads VALUES(?,?,?,?,?,?)', (second, 'Other', '/work/project', 'cli', 0, str(other))); conn.commit()
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock), str(other_lock)]), (None, True))
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('DELETE FROM threads'); conn.commit()
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock), str(other_lock)]), (None, False))
        (self.root / 'state_5.sqlite').unlink()
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock)]), (None, True))

    def test_client_lock_rejects_aliases_and_only_explicitly_resumed_migrations(self):
        thread, lock = self.client_fixture()
        alias = self.path.with_name('alias.jsonl'); alias.symlink_to(self.path)
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('UPDATE threads SET rollout_path=?', (str(alias),)); conn.commit()
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock)]), (None, True))
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('UPDATE threads SET rollout_path=?', (str(self.path),)); conn.commit()
        self.meta['cwd'] = '/old/project'
        self.path.write_text(json.dumps({'type': 'session_meta', 'payload': self.meta}) + '\n')
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock)]), (None, True))
        self.assertEqual(match_client_thread(self.root, self.info, [str(lock)], thread), ((str(self.path), thread), True))

    def test_claude_follows_current_foreground_pid_after_move(self):
        CLAUDE_PANES.clear()
        self.addCleanup(CLAUDE_PANES.clear)
        live = {'w1:pF': 999, 'w3:p1': 123}
        def request(method, params, session):
            self.assertEqual(session, 'default')
            if method == 'pane.list':
                return {'panes': [{'pane_id': p, 'agent': 'claude'} for p in live]}
            pane = params['pane_id']
            return {'process_info': {'pane_id': pane, 'foreground_processes':
                    [{'pid': live[pane], 'name': 'claude'}] if pane in live else []}}
        self.assertEqual(foreground_claude_pane('w1:pF', 123, 'lifetime', 'default', request), 'w3:p1')
        live['w3:p1'] = 999
        live['w4:p2'] = 123
        self.assertEqual(foreground_claude_pane('w1:pF', 123, 'lifetime', 'default', request), 'w4:p2')
        live['w5:p1'] = 456
        self.assertIsNone(foreground_claude_pane('w1:pF', 789, 'other-lifetime', 'default', request))
        live['w4:p2'] = 789
        live['w5:p1'] = 789
        self.assertIsNone(foreground_claude_pane('w1:pF', 789, 'other-lifetime', 'default', request))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / 'sessions').mkdir()
        self.path = self.root / 'sessions/main.jsonl'
        self.meta = dict(id='thread', source='vscode', originator='codex-tui',
                         thread_source='user', cwd='/work/project')
        self.write_meta()
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('CREATE TABLE threads(id,name,cwd,source,archived,rollout_path)')
            conn.execute('INSERT INTO threads VALUES(?,?,?,?,?,?)',
                         ('thread', 'Project research', '/work/project', 'vscode', 0, str(self.path)))
            conn.commit()
        self.info = dict(agent='codex', foreground_cwd='/work/project',
                         terminal_title_stripped='Project research | project', label='Arbitrary pane label')

    def write_meta(self):
        self.path.write_text(json.dumps({'payload': self.meta}) + '\n')

    def match(self, paths=None):
        return match_daemon_thread(self.root, self.info, paths if paths is not None else {str(self.path)})

    def test_blocked_caption_uses_only_previously_proven_still_owned_thread(self):
        from collector import match_blocked_thread
        previous = {'caption': self.info['terminal_title_stripped'], 'thread': 'thread'}
        info = {**self.info, 'agent': None, 'agent_status': 'blocked', 'terminal_title_stripped': 'Waiting for input'}
        self.assertEqual(match_blocked_thread(self.root, info, {str(self.path)}, None, previous, ''), (str(self.path), 'thread'))
        self.assertIsNone(match_blocked_thread(self.root, info, set(), None, previous, ''))
        self.assertIsNone(match_blocked_thread(self.root, {**info, 'foreground_cwd': '/other'}, {str(self.path)}, None, previous, ''))
        self.assertIsNone(match_blocked_thread(self.root, {**info, 'agent_status': 'working'}, {str(self.path)}, None, previous, 'normal output'))

    def test_matches_exact_live_name_and_cwd_not_pane_label(self):
        self.assertEqual(self.match(), (str(self.path), 'thread'))
        self.info['label'] = 'Other project'
        self.assertIsNotNone(self.match())
        self.info['terminal_title_stripped'] = 'Different title | project'
        self.assertIsNone(self.match())

    def test_rejects_closed_ambiguous_and_wrong_directory_threads(self):
        self.assertIsNone(self.match(set()))
        self.info['foreground_cwd'] = '/other/project'
        self.assertIsNone(self.match())
        self.info['foreground_cwd'] = '/work/project'
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('INSERT INTO threads SELECT * FROM threads')
            conn.commit()
        self.assertIsNone(self.match())

    def test_rejects_non_tui_subagent_and_incorrect_identity(self):
        for field, value in [('originator', 'vscode'), ('source', {'subagent': {}}),
                             ('thread_source', 'subagent'), ('id', 'other')]:
            old = self.meta[field]
            self.meta[field] = value
            self.write_meta()
            self.assertIsNone(self.match())
            self.meta[field] = old

    def test_rejects_symlink_and_missing_database(self):
        other = self.root / 'outside.jsonl'
        self.path.rename(other)
        self.path.symlink_to(other)
        self.assertIsNone(self.match())
        (self.root / 'state_5.sqlite').unlink()
        self.assertIsNone(self.match())
        self.assertFalse((self.root / 'state_5.sqlite').exists())

    def test_resumed_cli_thread_requires_matching_origin_and_unique_title(self):
        self.meta['source'] = 'cli'
        self.write_meta()
        self.assertIsNone(self.match())  # Database and rollout must agree.
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute("UPDATE threads SET source='cli'")
            conn.commit()
        self.assertEqual(self.match(), (str(self.path), 'thread'))
        self.assertIsNone(self.match(set()))
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute("INSERT INTO threads SELECT id,name,cwd,'vscode',archived,rollout_path FROM threads")
            conn.commit()
        self.assertIsNone(self.match())  # Ambiguity across both origins fails closed.

    def test_moved_thread_requires_exact_explicit_resume_identity(self):
        self.meta['cwd'] = '/work/old-project'
        self.write_meta()
        self.assertIsNone(self.match())
        self.assertIsNone(match_daemon_thread(self.root, self.info, {str(self.path)}, 'other-thread'))
        self.assertEqual(match_daemon_thread(self.root, self.info, {str(self.path)}, 'thread'),
                         (str(self.path), 'thread'))
        self.assertIsNone(match_daemon_thread(self.root, self.info, set(), 'thread'))
        self.info['foreground_cwd'] = '/work/unrelated'
        self.assertIsNone(match_daemon_thread(self.root, self.info, {str(self.path)}, 'thread'))

    def test_writer_lock_keeps_mapping_during_rollout_descriptor_rotation(self):
        thread = '00000000-0000-0000-0000-000000000067'
        self.meta['id'] = thread
        self.write_meta()
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('UPDATE threads SET id=?', (thread,))
            conn.commit()
        lock = str(self.root / 'thread-writer-locks' / (thread + '.lock'))
        self.assertEqual(self.match({lock}), (str(self.path), thread))
        self.assertIsNone(self.match({lock + '.other'}))

    def test_action_required_title_restores_history_without_cached_attachment(self):
        self.info.update(agent_status='blocked', terminal_title_stripped='[ ! ] Action Required | Project research | project')
        self.assertEqual(self.match(), (str(self.path), 'thread'))
        self.assertIsNone(self.match(set()))
        self.info['agent_status']='working'
        self.assertIsNone(self.match())
        self.info['agent_status']='blocked'
        self.info['foreground_cwd']='/another/project'
        self.assertIsNone(self.match())

    def test_action_required_still_rejects_ambiguous_threads(self):
        self.info.update(agent_status='blocked', terminal_title_stripped='[ ! ] Action Required | Project research | project')
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('INSERT INTO threads SELECT * FROM threads')
            conn.commit()
        self.assertIsNone(self.match())

    def test_exact_title_takes_precedence_over_status_decoration(self):
        self.info.update(agent_status='blocked', terminal_title_stripped='[ ! ] Action Required | Project research | project')
        with closing(sqlite3.connect(self.root / 'state_5.sqlite')) as conn:
            conn.execute('INSERT INTO threads VALUES(?,?,?,?,?,?)',
                         ('other', '[ ! ] Action Required | Project research', '/work/project', 'vscode', 0, '/not/held.jsonl'))
            conn.commit()
        self.assertIsNone(self.match())
