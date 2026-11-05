import unittest
from unittest.mock import Mock
from replies import ReplyError, Server, send_reply, validate_reply
import threading
from types import SimpleNamespace

SESSION = '12345678-1234-1234-1234-123456789012'


class Replies(unittest.TestCase):
    def test_reset_lock_is_separate_from_terminal_input(self):
        server = SimpleNamespace(sending=threading.BoundedSemaphore(1), resetting=threading.BoundedSemaphore(1))
        with Server.input_guard(server, {'operation': 'usage_reset'}):
            with Server.input_guard(server, {'text': 'reply'}): pass
            with self.assertRaises(ReplyError):
                with Server.input_guard(server, {'operation': 'usage_reset'}): pass
    @staticmethod
    def normal_api():
        return Mock(side_effect=lambda method, params: {'read': {'text': '› Ask Codex to do anything'}}
                    if method == 'pane.read' else {'process_info': {'foreground_processes': [{'name': 'codex'}]}})

    def test_background_requests_do_not_hold_the_input_lock(self):
        server = SimpleNamespace(sending=threading.BoundedSemaphore(1))
        for body in [{'operation': 'choice', 'action': 'inspect'},
                     {'operation': 'history'}, {'operation': 'bookmarks', 'action': 'add'}]:
            with Server.input_guard(server, body):
                self.assertTrue(server.sending.acquire(blocking=False))
                server.sending.release()
        with Server.input_guard(server, {'text': 'reply'}):
            self.assertFalse(server.sending.acquire(blocking=False))
            # A read still proceeds while another thread owns the input lock.
            with Server.input_guard(server, {'operation': 'choice', 'action': 'inspect'}):
                pass

    def test_actual_input_waits_and_releases_on_failure(self):
        server = SimpleNamespace(sending=threading.BoundedSemaphore(1))
        server.sending.acquire()
        entered = threading.Event()
        def send():
            with Server.input_guard(server, {'operation': 'choice', 'action': 'select'}):
                entered.set()
        worker = threading.Thread(target=send)
        worker.start()
        self.assertFalse(entered.wait(.05))
        server.sending.release()
        worker.join(1)
        self.assertTrue(entered.is_set())
        with self.assertRaises(ValueError):
            with Server.input_guard(server, {'text': 'reply'}):
                raise ValueError('failed validation')
        self.assertTrue(server.sending.acquire(blocking=False))
        server.sending.release()

    def test_only_literal_text_and_enter_to_matching_live_codex(self):
        api = self.normal_api()
        result = send_reply({'pane': 'w6:p1', 'session': SESSION, 'text': 'Explain $x$.\nNot yet verified?'},
                            lambda: {'w6:p1': ('/owned/rollout.jsonl', SESSION)}, api)
        self.assertEqual(result, {'status': 'sent'})
        self.assertEqual(api.call_count, 3)
        api.assert_called_with('pane.send_input', {'pane_id': 'w6:p1', 'text': 'Explain $x$.\nNot yet verified?', 'keys': ['Enter']})

    def test_first_message_to_process_bound_pending_session(self):
        api = self.normal_api()
        self.assertEqual(send_reply({'pane': 'w3:pV', 'session': SESSION, 'text': 'First message'},
                         lambda: {'w3:pV': (None, SESSION)}, api), {'status': 'sent'})
        api.assert_called_with('pane.send_input', {'pane_id': 'w3:pV', 'text': 'First message', 'keys': ['Enter']})

    def test_reply_checks_live_prompt_and_never_types_into_question_or_approval(self):
        for screen in ('Queued follow-up inputs\n1 question\nalt+↑ to answer',
                       'Question 1/1\n1. Yes\n2. No\nenter select',
                       'Bash command\necho test\nThis command requires approval\nDo you want to proceed?\n ❯ 1. Yes\n   2. No\n\nEsc to cancel'):
            api = Mock(side_effect=lambda method, params: {'read': {'text': screen}}
                       if method == 'pane.read' else {'process_info': {'foreground_processes': [{'name': 'codex'}]}})
            with self.subTest(screen=screen), self.assertRaises(ReplyError) as error:
                send_reply({'pane': 'w6:p1', 'session': SESSION, 'text': 'My ordinary reply'},
                           lambda: {'w6:p1': ('/owned/rollout.jsonl', SESSION)}, api)
            self.assertEqual(error.exception.status, 409)
            self.assertFalse(any(call.args[0] == 'pane.send_input' for call in api.call_args_list))
            self.assertEqual(api.call_args.args, ('pane.read', {'pane_id': 'w6:p1', 'source': 'detection',
                             'lines': 80, 'format': 'text', 'strip_ansi': True}))

    def test_unreadable_live_prompt_fails_without_typing(self):
        api = Mock(side_effect=lambda method, params: (_ for _ in ()).throw(OSError('unavailable'))
                   if method == 'pane.read' else {'process_info': {'foreground_processes': [{'name': 'codex'}]}})
        with self.assertRaises(OSError):
            send_reply({'pane': 'w6:p1', 'session': SESSION, 'text': 'My reply'},
                       lambda: {'w6:p1': ('/owned/rollout.jsonl', SESSION)}, api)
        self.assertFalse(any(call.args[0] == 'pane.send_input' for call in api.call_args_list))

    def test_no_send_when_session_changed_or_shell_in_foreground(self):
        body = {'pane': 'w6:p1', 'session': SESSION, 'text': 'reply'}
        api = Mock(return_value={'process_info': {'foreground_processes': [{'name': 'bash'}]}})
        for mappings in [{}, {'w6:p1': ('path', 'different')}, {'w6:p1': ('path', SESSION)}]:
            api.reset_mock()
            with self.assertRaises(ReplyError) as e:
                send_reply(body, lambda: mappings, api)
            self.assertEqual(e.exception.status, 409)
            self.assertFalse(any(c.args[0] == 'pane.send_input' for c in api.call_args_list))

    def test_reject_control_input_oversize_and_injected_parameters(self):
        body = {'pane': 'w6:p1', 'session': SESSION, 'text': 'reply'}
        for change in [{'text': ''}, {'text': '\x1b[200~bad'}, {'text': 'x\r'}, {'text': '\x00'},
                       {'text': 'x' * 16001}, {'text': 'π' * 8001}, {'pane': '../bad'}, {'session': 'bad'}, {'method': 'server.stop'}]:
            with self.subTest(change=list(change)), self.assertRaises(ReplyError):
                validate_reply({**body, **change})


if __name__ == '__main__':
    unittest.main()
