import unittest
from unittest.mock import Mock, patch
from login_prompt import claude_login_url
from choices import inspect_choice, choice_request
from replies import ReplyError, send_reply

URL = ('https://claude.ai/oauth/authorize?client_id=test-client&response_type=code'
       '&code_challenge=syntheticChallengeABCDEFGHIJKLMNOPQRSTUVWXYZ&state=syntheticStateABCDEFGHIJKLMNOPQRSTUVWXYZ')


def screen(width=61, url=URL):
    return "Browser didn't open? Use the url below to sign in:\n\n" + '\n'.join('  ' + url[i:i+width] for i in range(0, len(url), width)) + '\n\nPaste code here if prompted >'


class LoginPrompt(unittest.TestCase):
    def test_current_claude_com_route_and_exact_endpoint_pairs(self):
        url = URL.replace('claude.ai/oauth', 'claude.com/cai/oauth') + '&scope=' + 'synthetic%3Ascope%20' * 7
        current = screen(185, url).replace('sign in:', 'sign in (c to copy)')
        self.assertEqual(claude_login_url(current), url)
        self.assertEqual(claude_login_url(current.replace('\n  ', '\n')), url)
        for invalid in (url.replace('/cai/oauth', '/oauth'),
                        url.replace('claude.com/', 'claude.ai/'),
                        url.replace('claude.com/', 'claude.com.attacker.test/')):
            self.assertIsNone(claude_login_url(screen(185, invalid)))

    def test_reassembles_every_wrap_position_without_changing_oauth_values(self):
        for width in range(25, len(URL)):
            with self.subTest(width=width):
                self.assertEqual(claude_login_url(screen(width)), URL)
        self.assertEqual(claude_login_url(screen().replace('Use the url below', '\nUse the url below')), URL)

    def test_ignores_transcripts_unrelated_urls_incomplete_or_unsafe_links(self):
        for text in (URL, screen().replace('claude.ai', 'attacker.test'),
                     screen().replace('https://', 'http://'), screen().replace('client_id=', 'omitted='),
                     screen().replace('https://claude.ai', 'https://user@claude.ai'),
                     screen().replace('oauth/authorize', 'other/resource'),
                     "Browser didn't open?\nhttps://claude.ai/oauth/authorize?state=only\n",
                     "Browser didn't open?\n" + URL + '#' + 'fragment',
                     "Browser didn't open?\n" + URL + 'x' * 9000):
            with self.subTest(text=text[:40]): self.assertIsNone(claude_login_url(text))

    def test_login_is_read_only_and_works_before_a_transcript_exists(self):
        def request(method, params):
            if method == 'pane.process_info': return {'process_info': {'foreground_processes': [{'pid':12, 'name':'claude'}]}}
            if method == 'pane.get': return {'pane': {}}
            if method == 'pane.read':
                self.assertEqual(params['source'], 'detection')
                return {'read': {'text': screen()}}
            self.fail('Sign-in inspection sent terminal input')
        with patch('choices.identity', return_value={'start':'lifetime', 'profile':'/profile', 'cwd':'/project'}), patch('choices.claude.match_session', return_value=None):
            state = inspect_choice('w1:p1', request)
        self.assertEqual(state['loginUrl'], URL)
        self.assertEqual(state['kind'], 'login')
        for action in ('open', 'select', 'cancel', 'up', 'down'):
            api = Mock()
            with patch('choices.inspect_choice', return_value=state), self.assertRaises(ReplyError):
                choice_request({'operation':'choice', 'pane':'w1:p1', 'action':action, 'token':state['token'], 'frame':state['frame']}, api)
            api.assert_not_called()
        with patch('choices.identity', side_effect=ReplyError(409,'Not owned')):
            self.assertEqual(inspect_choice('w1:p1', request), {'active':False})

    def test_normal_reply_cannot_be_submitted_into_login(self):
        api = Mock(side_effect=lambda method, params: {'read': {'text': screen()}}
                   if method == 'pane.read' else {'process_info': {'foreground_processes': [{'name': 'claude'}]}})
        session = '12345678-1234-1234-1234-123456789012'
        with self.assertRaises(ReplyError) as error:
            send_reply({'pane': 'w1:p1', 'session': session, 'text': 'An ordinary reply'},
                       lambda: {'w1:p1': (None, session)}, api)
        self.assertEqual(error.exception.status, 409)
        self.assertFalse(any(call.args[0] == 'pane.send_input' for call in api.call_args_list))
