import importlib.util
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from quota_reset import reset_request
from replies import ReplyError

spec = importlib.util.spec_from_file_location('test_usage_reset_fields', Path(__file__).resolve().parent.parent / 'usage-service/collector.py')
fields = importlib.util.module_from_spec(spec); spec.loader.exec_module(fields)

class ResetControl(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve(); self.database = self.base / 'resets.sqlite'
        self.home = '/owned/profile'; self.calls = []
        self.limits = {'accountId': 'account', 'rateLimits': {}, 'rateLimitResetCredits': {'availableCount': 2, 'credits': [
            {'id': 'credit-one', 'status': 'available', 'resetType': 'codexRateLimits', 'expiresAt': None}]}}
        self.outcome = 'reset'; self.fail_once = False
        owner = self
        class Reader:
            def __init__(self, home, allow_reset=False):
                owner.assertEqual(home, owner.home); owner.assertTrue(allow_reset)
            def send(self, message): pass
            def call(self, method, params=None):
                owner.calls.append((method, params))
                if method == 'account/read': return {'account': {'type': 'chatgpt', 'email': 'account@example.test'}}
                if method == 'account/rateLimits/read': return owner.limits
                if method == 'account/rateLimitResetCredit/consume':
                    if owner.fail_once: owner.fail_once = False; raise TimeoutError('uncertain')
                    return {'outcome': owner.outcome}
                return {}
            def close(self): pass
        self.usage = SimpleNamespace(CodexReader=Reader, codex_extras=fields.codex_extras, codex_windows=fields.codex_windows,
            process_profile=lambda process, pane: ('codex', self.home, 123) if process.get('name') == 'codex' else None,
            PROFILES={self.home: 'Test profile'}, CACHE=self.base, atomic_json=fields.atomic_json)
        self.api = Mock(return_value={'process_info': {'foreground_processes': [{'name': 'codex', 'pid': 123}]}})
        self.body = {'operation': 'usage_reset', 'pane': 'w3:pZ', 'accountKey': fields.codex_extras(self.limits, self.home)['accountKey'],
                     'requestId': '935b1e46-f4fa-4361-a8d9-f8a91cfefc9e', 'creditId': 'credit-one', 'availableCount': 2}
    def run_request(self, body=None): return reset_request(body or self.body, self.database, self.api, self.usage)
    def consumes(self): return [call for call in self.calls if call[0] == 'account/rateLimitResetCredit/consume']
    def test_consumes_once_and_persists_idempotent_receipt_without_terminal_input(self):
        self.assertEqual(self.run_request()['outcome'], 'reset')
        self.assertEqual(self.run_request()['outcome'], 'alreadyRedeemed')
        self.assertEqual(len(self.consumes()), 1)
        self.assertEqual(self.consumes()[0][1], {'idempotencyKey': self.body['requestId'], 'creditId': 'credit-one'})
        self.assertTrue(all(call.args[0] == 'pane.process_info' for call in self.api.call_args_list))
        self.assertEqual(self.database.stat().st_mode & 0o777, 0o600)
    def test_uncertain_attempt_reuses_nonce_after_inventory_changes(self):
        self.fail_once = True
        with self.assertRaises(TimeoutError): self.run_request()
        self.limits['rateLimitResetCredits'] = {'availableCount': 1, 'credits': []}
        self.outcome = 'alreadyRedeemed'
        self.assertEqual(self.run_request()['outcome'], 'alreadyRedeemed')
        self.assertEqual(self.consumes()[0][1], self.consumes()[1][1])
    def test_rejects_account_count_credit_and_profile_changes_before_any_redemption(self):
        for change in ({'accountKey': '0' * 64}, {'availableCount': 1}, {'creditId': 'not-offered'}):
            with self.subTest(change=change), self.assertRaises(ReplyError): self.run_request({**self.body, **change})
            self.assertEqual(self.consumes(), [])
        self.api.return_value = {'process_info': {'foreground_processes': [{'name': 'claude', 'pid': 123}]}}
        with self.assertRaises(ReplyError): self.run_request()
        self.assertEqual(self.consumes(), [])
    def test_rejects_injected_parameters_and_expired_reset(self):
        for change in ({'home': '/foreign'}, {'method': 'account/logout'}, {'creditId': '\x1b'}, {'requestId': 'bad'}, {'availableCount': True}):
            with self.subTest(change=change), self.assertRaises(ReplyError): self.run_request({**self.body, **change})
        self.limits['rateLimitResetCredits']['credits'][0]['expiresAt'] = 1
        with self.assertRaises(ReplyError): self.run_request()
        self.assertEqual(self.consumes(), [])
