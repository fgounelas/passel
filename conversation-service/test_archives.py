import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from archives import Archives
from replies import ReplyError
from tab_lifecycle import quit_session, resume_session, empty_shell_prompt, quit_composer_ready, prepare_claude_launcher


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'state/archives.sqlite'
        self.store = Archives(self.path)
        self.snapshot = {'tabs': [{'tab_id': 'w1:t1'}], 'panes': [
            {'tab_id': 'w1:t1', 'pane_id': 'w1:p1', 'terminal_id': 'term-original'}]}
        self.api = Mock(side_effect=lambda method, params: {'snapshot': self.snapshot})

    def call(self, action, **kwargs):
        return self.store.request({'operation': 'archives', 'action': action, **kwargs}, request=self.api)

    def test_archive_restore_persist_without_process_actions(self):
        self.assertEqual(self.call('archive', tab='w1:t1')['tabs'], ['w1:t1'])
        self.store = Archives(self.path)
        self.assertEqual(self.call('list')['tabs'], ['w1:t1'])
        self.assertEqual(self.call('restore', tab='w1:t1')['tabs'], [])
        self.assertEqual(self.call('restore', tab='w1:t1')['tabs'], [])
        self.assertTrue(all(call.args[0] == 'session.snapshot' for call in self.api.call_args_list))
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_legacy_reused_id_and_closed_tabs_are_not_shown(self):
        self.call('archive', tab='w1:t1')
        self.snapshot['panes'][0]['terminal_id'] = 'term-new'
        self.assertEqual(self.call('list')['tabs'], [])
        self.call('archive', tab='w1:t1')
        self.snapshot['tabs'] = []
        self.assertEqual(self.call('list')['tabs'], [])

    def test_restart_keeps_archive_and_saved_resume_on_same_persisted_tab(self):
        self.snapshot['tabs'][0]['workspace_id'] = 'w1'
        self.snapshot['panes'][0]['cwd'] = '/work/project'
        saved = {'pane': 'w1:p1', 'session': 'original-session'}
        with patch('tab_lifecycle.quit_session', return_value=saved):
            self.call('quit', tab='w1:t1')
        self.snapshot['panes'][0]['terminal_id'] = 'term-after-restart'
        self.store = Archives(self.path)
        self.assertEqual(self.call('list'), {'tabs': ['w1:t1'], 'stopped': ['w1:t1']})
        with patch('tab_lifecycle.resume_session') as resume:
            self.call('resume', tab='w1:t1')
            resume.assert_called_once_with(saved, self.api)

    def test_changed_project_and_transient_empty_snapshot_do_not_delete_state(self):
        self.snapshot['tabs'][0]['workspace_id'] = 'w1'
        self.snapshot['panes'][0]['cwd'] = '/work/project'
        self.call('archive', tab='w1:t1')
        self.snapshot['panes'][0]['cwd'] = '/work/unrelated'
        self.snapshot['panes'][0]['terminal_id'] = 'term-new'
        self.assertEqual(self.call('list')['tabs'], [])
        self.snapshot['panes'][0]['cwd'] = '/work/project'
        self.assertEqual(self.call('list')['tabs'], ['w1:t1'])
        tabs = self.snapshot['tabs']
        self.snapshot['tabs'] = []
        self.assertEqual(self.call('list')['tabs'], [])
        self.snapshot['tabs'] = tabs
        self.assertEqual(self.call('list')['tabs'], ['w1:t1'])

    def test_legacy_rows_adopt_persisted_identity_before_restart(self):
        self.snapshot['tabs'][0]['workspace_id'] = 'w1'
        self.snapshot['panes'][0]['cwd'] = '/work/project'
        self.call('archive', tab='w1:t1')
        with self.store.connect() as db:
            db.execute('UPDATE archived_tabs SET identity=NULL')
        self.assertEqual(self.call('list')['tabs'], ['w1:t1'])
        self.snapshot['panes'][0]['terminal_id'] = 'replacement-terminal'
        self.assertEqual(self.call('list')['tabs'], ['w1:t1'])

    def test_different_attached_conversation_does_not_erase_saved_resume(self):
        with patch('tab_lifecycle.quit_session', return_value={'pane': 'w1:p1', 'session': 'original'}):
            self.call('quit', tab='w1:t1')
        result = self.store.request({'operation': 'archives', 'action': 'list'},
            discover=lambda: {'w1:p1': ('path', 'different')}, request=self.api)
        self.assertEqual(result['stopped'], ['w1:t1'])

    def test_reject_unknown_and_injected_action_before_api(self):
        for body in [{'action': 'kill'}, {'action': 'quit', 'tab': '../all'},
                     {'action': 'archive', 'tab': 'w1:t1', 'pid': 1}]:
            with self.assertRaises(ReplyError):
                self.store.request({'operation': 'archives', **body}, request=self.api)
        self.api.assert_not_called()
        with self.assertRaises(ReplyError): self.call('archive', tab='missing')

    def test_quit_failure_never_archives_and_split_tabs_rejected(self):
        with patch('tab_lifecycle.quit_session', side_effect=ReplyError(409, 'still running')) as stop:
            with self.assertRaises(ReplyError): self.call('quit', tab='w1:t1')
            self.assertEqual(self.call('list')['tabs'], [])
            stop.assert_called_once()
            self.snapshot['panes'].append({**self.snapshot['panes'][0], 'pane_id': 'w1:p2'})
            with self.assertRaises(ReplyError): self.call('quit', tab='w1:t1')
            stop.assert_called_once()

    def test_quit_persists_resume_restore_does_not_launch(self):
        saved = {'pane': 'w1:p1', 'session': 'session'}
        with patch('tab_lifecycle.quit_session', return_value=saved), patch('tab_lifecycle.resume_session') as resume:
            self.assertEqual(self.call('quit', tab='w1:t1'), {'tabs': ['w1:t1'], 'stopped': ['w1:t1']})
            self.assertEqual(self.call('restore', tab='w1:t1'), {'tabs': [], 'stopped': ['w1:t1']})
            resume.assert_not_called()
            self.assertEqual(self.call('resume', tab='w1:t1'), {'tabs': [], 'stopped': []})
            resume.assert_called_once_with(saved, self.api)
            with self.assertRaises(ReplyError): self.call('resume', tab='w1:t1')

    def test_failed_resume_keeps_saved_details_for_retry(self):
        saved = {'pane': 'w1:p1', 'session': 'session'}
        with patch('tab_lifecycle.quit_session', return_value=saved): self.call('quit', tab='w1:t1')
        with patch('tab_lifecycle.resume_session', side_effect=ReplyError(409, 'not started')):
            with self.assertRaises(ReplyError): self.call('resume', tab='w1:t1')
        self.assertEqual(self.call('list'), {'tabs': ['w1:t1'], 'stopped': ['w1:t1']})

    def test_manually_resumed_session_removes_stale_resume_button(self):
        with patch('tab_lifecycle.quit_session', return_value={'pane': 'w1:p1'}): self.call('quit', tab='w1:t1')
        result = self.store.request({'operation': 'archives', 'action': 'list'},
            discover=lambda: {'w1:p1': ('path', 'session')}, request=self.api)
        self.assertEqual(result['stopped'], [])


class LifecycleTests(unittest.TestCase):
    def test_no_input_to_ambiguous_or_non_codex_pane(self):
        for processes in [[], [{'name': 'bash', 'pid': 8}], [{'name': 'codex', 'pid': 8}, {'name': 'codex', 'pid': 9}]]:
            api = Mock(return_value={'process_info': {'foreground_processes': processes}})
            with self.assertRaises(ReplyError): quit_session('w1:p1', lambda: {}, api)
            api.assert_called_once()

    def test_pidfd_identity_change_never_sends_input(self):
        process = {'foreground_processes': [{'name': 'codex', 'pid': 8}], 'foreground_process_group_id': 8}
        api = Mock(return_value={'process_info': process})
        with patch('tab_lifecycle.identity', side_effect=[{'group': 8}, {'group': 9}]), \
             patch('tab_lifecycle.os.pidfd_open', create=True, return_value=42), patch('tab_lifecycle.os.close'):
            with self.assertRaises(ReplyError): quit_session('w1:p1', lambda: {}, api)
            self.assertFalse(any(c.args[0] == 'pane.send_input' for c in api.call_args_list))

    def test_graceful_quit_stages_command_and_tracks_original_exit(self):
        process = {'foreground_processes': [{'name': 'codex', 'pid': 8}], 'foreground_process_group_id': 8}
        api = Mock(return_value={'process_info': process})
        with patch('tab_lifecycle.identity', return_value={'group': 8}), \
             patch('tab_lifecycle.os.pidfd_open', create=True, return_value=42), \
             patch('tab_lifecycle.os.close'), patch('tab_lifecycle.terminal_text', return_value='› /quit\n\n'), \
             patch('tab_lifecycle.select.select', side_effect=[([], [], [])]*4 + [([42], [], [])]):
            quit_session('w1:p1', lambda: {}, api)
        sent = [c.args[1] for c in api.call_args_list if c.args[0] == 'pane.send_input']
        self.assertEqual(sent, [{'pane_id': 'w1:p1', 'keys': ['Escape', 'Ctrl+u', 'Ctrl+k']},
                               {'pane_id': 'w1:p1', 'text': '/quit'}, {'pane_id': 'w1:p1', 'keys': ['Enter']}])

    def test_quit_never_enters_if_draft_could_not_be_cleared(self):
        process = {'foreground_processes': [{'name': 'codex', 'pid': 8}], 'foreground_process_group_id': 8}
        api = Mock(return_value={'process_info': process})
        with patch('tab_lifecycle.identity', return_value={'group': 8}), \
             patch('tab_lifecycle.os.pidfd_open', create=True, return_value=42), patch('tab_lifecycle.os.close'), \
             patch('tab_lifecycle.terminal_text', return_value='› leftover\n  /quit'), \
             patch('tab_lifecycle.time.monotonic', side_effect=[0, 2]), \
             patch('tab_lifecycle.select.select', return_value=([], [], [])):
            with self.assertRaises(ReplyError): quit_session('w1:p1', lambda: {}, api)
        self.assertFalse(any(c.args[1].get('keys') == ['Enter'] for c in api.call_args_list))

    def test_delayed_exit_stops_all_further_input_and_preserves_resume(self):
        process = {'foreground_processes': [{'name': 'codex', 'pid': 8}], 'foreground_process_group_id': 8}
        for live_checks, expected_sends in [(0, 0), (1, 1), (2, 2), (3, 2)]:
            api = Mock(return_value={'process_info': process})
            with patch('tab_lifecycle.identity', return_value={'group': 8}), \
                 patch('tab_lifecycle.os.pidfd_open', create=True, return_value=42), \
                 patch('tab_lifecycle.os.close'), patch('tab_lifecycle.terminal_text', return_value='› /quit\n\n'), \
                 patch('tab_lifecycle.select.select', side_effect=[([], [], [])]*live_checks + [([42], [], [])]):
                saved = quit_session('w1:p1', lambda: {'w1:p1': ('rollout', '12345678-1234-1234-1234-123456789012')}, api)
            self.assertEqual(saved['session'], '12345678-1234-1234-1234-123456789012')
            sent = [c.args[1] for c in api.call_args_list if c.args[0] == 'pane.send_input']
            self.assertEqual(len(sent), expected_sends)
            self.assertFalse(any(v.get('keys') == ['Enter'] for v in sent))

    def test_prompt_recognition_rejects_typed_text_continuations_and_custom_prompts(self):
        shell = {'cwd': '/home/example/work/danus'}
        prompt = 'example@host:~/work/danus$'
        def check(text): return empty_shell_prompt(text, shell, '/home/example', 'example', 'host')
        self.assertEqual(check('old output\n' + prompt + ' '), prompt)
        for text in [prompt + ' accidental prefix', prompt + ' echo $', prompt + '\n> ', 'custom >', 'other@host:~/work/danus$']:
            self.assertIsNone(check(text))
        self.assertTrue(quit_composer_ready('› /quit  exit Codex\n\n› /quit\n\n footer'))
        self.assertFalse(quit_composer_ready('› draft/quit\n\n footer'))
        self.assertFalse(quit_composer_ready('› /quit\n  leftover multiline draft\n\n footer'))

    def test_claude_uses_exit_and_saves_agent_for_resume(self):
        process = {'foreground_processes': [{'name': 'claude', 'pid': 8}], 'foreground_process_group_id': 8}
        api = Mock(return_value={'process_info': process})
        with patch('tab_lifecycle.identity', return_value={'group': 8, 'profile': '/home/example/.claude'}) as check, \
             patch('tab_lifecycle.prepare_claude_launcher'), \
             patch('tab_lifecycle.os.pidfd_open', create=True, return_value=42), \
             patch('tab_lifecycle.os.close'), patch('tab_lifecycle.terminal_text', return_value='❯ /exit\n────────'), \
             patch('tab_lifecycle.select.select', side_effect=[([], [], [])]*4 + [([42], [], [])]):
            saved = quit_session('w1:p1', lambda: {'w1:p1': ('path','12345678-1234-1234-1234-123456789012')}, api)
        self.assertEqual(saved['agent'], 'claude')
        self.assertEqual(saved['session'], '12345678-1234-1234-1234-123456789012')
        check.assert_called_with(8, 'w1:p1', 'claude')
        sent = [c.args[1] for c in api.call_args_list if c.args[0] == 'pane.send_input']
        self.assertEqual(sent[1], {'pane_id':'w1:p1', 'text':'/exit'})
        self.assertTrue(quit_composer_ready('❯ /exit\n────────', 'claude'))
        self.assertTrue(quit_composer_ready('❯\u00a0/exit\n────────', 'claude'))
        self.assertFalse(quit_composer_ready('❯ /exit\n  unwanted text', 'claude'))
        self.assertFalse(quit_composer_ready('❯ draft/exit\n────────', 'claude'))

    def test_resume_uses_saved_agent_profile_and_exact_uuid(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder)/'agent';executable.write_text('test');executable.chmod(0o700)
            for agent, flag, variable, explicit in [('codex','resume','CODEX_HOME',True), ('claude','--resume','CLAUDE_CONFIG_DIR',True), ('claude','--resume','CLAUDE_CONFIG_DIR',False)]:
                saved={'pane':'w1:p1','agent':agent,'profile':folder,'cwd':folder,'executable':str(executable),'session':'12345678-1234-1234-1234-123456789012'}
                if agent == 'claude':
                    saved['profile_explicit'] = explicit
                    launcher = Path(folder)/'claude'
                    if not launcher.exists(): launcher.symlink_to(executable)
                    saved['launcher'] = str(launcher)
                api=Mock(return_value={'process_info':{'foreground_processes':[{'name':agent,'pid':8,'argv':[str(executable),flag,saved['session']]}]}})
                with patch('tab_lifecycle.shell_info',return_value={'pid':7}), \
                     patch('tab_lifecycle.empty_shell_prompt',return_value='example@host:~$'), \
                     patch('tab_lifecycle.terminal_text',return_value='example@host:~$'), \
                     patch('tab_lifecycle.wait_for_text'), patch('tab_lifecycle.identity',return_value=saved):
                    resume_session(saved,api)
                command = next(c.args[1]['text'] for c in api.call_args_list if c.args[0]=='pane.send_input' and 'text' in c.args[1])
                self.assertIn(variable+'='+folder if explicit else '-u '+variable,command)
                self.assertIn(flag+' '+saved['session'],command)
                if agent == 'claude': self.assertIn(str(launcher),command)

    def test_claude_launcher_uses_persistent_user_state_outside_installed_source(self):
        from tab_lifecycle import claude_launcher_path
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            state = home / 'containers/herdr-web/conversation-state'
            state.mkdir(parents=True)
            binary = home / 'claude'; binary.write_text('test binary')
            with patch('tab_lifecycle.Path.home', return_value=home), \
                    patch.dict('tab_lifecycle.os.environ') as environment:
                environment.pop('PASSEL_STATE_DIR', None)
                launcher = claude_launcher_path(str(binary))
                self.assertTrue(launcher.is_relative_to(state / 'launchers'))
                prepare_claude_launcher({'executable': str(binary), 'launcher': str(launcher)})
                self.assertTrue(launcher.samefile(binary))

    def test_claude_launcher_pins_exact_binary_without_overwriting_an_existing_alias(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            binary=Path(folder)/'2.1.287';binary.write_text('binary')
            launcher=Path(folder)/'state/launchers/version/claude'
            saved={'executable':str(binary),'launcher':str(launcher)}
            with patch('tab_lifecycle.claude_launcher_path',return_value=launcher):
                prepare_claude_launcher(saved)
                prepare_claude_launcher(saved)
                self.assertEqual(launcher.resolve(),binary.resolve())
                launcher.unlink();launcher.symlink_to(Path(folder)/'other')
                with self.assertRaises(ReplyError):prepare_claude_launcher(saved)
                self.assertEqual(launcher.readlink(),Path(folder)/'other')

    def test_resume_refuses_busy_terminal(self):
        api = Mock(return_value={'process_info': {'shell_pid': 7, 'foreground_processes': [{'name': 'codex', 'pid': 8}]}})
        with self.assertRaises(ReplyError): resume_session({'pane': 'w1:p1'}, api)
        api.assert_called_once()

    def test_resume_refuses_nonempty_input_without_sending_anything(self):
        api = Mock(return_value={'process_info': {'shell_pid': 7, 'foreground_processes': [{'name': 'bash', 'pid': 7, 'cwd': '/home/example'}]}})
        with patch('tab_lifecycle.terminal_text', return_value='example@host:~$ existing input'), \
             patch('tab_lifecycle.empty_shell_prompt', return_value=None):
            with self.assertRaises(ReplyError): resume_session({'pane': 'w1:p1'}, api)
        api.assert_called_once()


if __name__ == '__main__': unittest.main()
