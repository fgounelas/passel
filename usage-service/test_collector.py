import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collector.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class QuotaTests(unittest.TestCase):
    def test_moved_claude_requires_matching_owned_daemon(self):
        from types import SimpleNamespace
        fields=b'HERDR_PANE_ID=w1:pF\0HERDR_SOCKET_PATH=/home/example/.config/herdr/herdr.sock\0'
        with patch.object(c.Path, 'stat', return_value=SimpleNamespace(st_uid=c.os.getuid())), patch.object(c.Path, 'read_bytes', return_value=fields), patch.object(c, 'QUOTA_SOCKET', '/home/example/.config/herdr/herdr.sock'):
            self.assertEqual(c.process_profile({'name':'claude','pid':123,'argv':['claude']}, 'w3:p1'), ('claude',str(Path.home()/'.claude'),123))
            self.assertIsNone(c.process_profile({'name':'codex','pid':123}, 'w3:p1'))
            with patch.object(c, 'QUOTA_SOCKET', '/foreign.sock'):
                self.assertIsNone(c.process_profile({'name':'claude','pid':123,'argv':['claude']}, 'w3:p1'))

    def test_default_session_hook_keys_sample_by_process_lifetime(self):
        import io,json
        from types import SimpleNamespace
        fields=['S','1','123','123','1','123',*['0']*13,'456']
        stat='123 (claude) '+' '.join(fields)
        def read_text(path, *args, **kwargs):
            return 'claude' if path.name=='comm' else stat
        data={'rate_limits':{'seven_day':{'used_percentage':22}}}
        with patch.dict(c.os.environ, {'HERDR_PANE_ID':'w1:pF','HERDR_SESSION':'default'}), patch('sys.stdin',SimpleNamespace(buffer=io.BytesIO(json.dumps(data).encode()))), patch.object(c.os,'getppid',return_value=123), patch.object(c.Path,'stat',return_value=SimpleNamespace(st_uid=c.os.getuid())), patch.object(c.Path,'read_text',read_text), patch.object(c,'atomic_json') as write:
            c.claude_statusline('work')
            write.assert_not_called()
            import sys
            sys.stdin.buffer.seek(0)
            c.claude_statusline('default')
            path,record=write.call_args.args
            self.assertEqual(path,c.claude_cache_path(123,'456'))
            self.assertEqual(record['processStart'],'456')
            self.assertEqual(record['windows'][0]['remaining'],78)

    def test_quota_survives_pane_move_and_bounds_inactive_process_cache(self):
        import tempfile,json
        with tempfile.TemporaryDirectory() as temp, patch.object(c,'CACHE',Path(temp)):
            path=c.claude_cache_path(123,'456')
            c.atomic_json(path,{'pid':123,'processStart':'456','windows':[{'minutes':10080,'remaining':78}]})
            for i in range(140):c.atomic_json(Path(temp)/f'claude-process-old-{i}.json',{})
            original=Path.read_text
            def read_text(path,*args,**kwargs):
                return '123 (claude) '+' '.join(['S']+['0']*18+['456']) if str(path).startswith('/proc/') else original(path,*args,**kwargs)
            pane='w1:pF'
            def daemon(*args):
                return {'panes':[{'pane_id':pane}]} if args==('pane','list') else {'process_info':{'foreground_processes':[{'name':'claude','pid':123}]}}
            with patch.object(c,'herdr',daemon),patch.object(c,'process_profile',return_value=('claude',str(Path.home()/'.claude'),123)),patch.object(c.Path,'read_text',read_text):
                c.collect({})
                pane='w3:p1'
                c.collect({})
                status=json.loads((Path(temp)/'status.json').read_text())
                self.assertEqual(status['panes'][pane]['windows'][0]['remaining'],78)
                self.assertEqual(len(list(Path(temp).glob('claude-process-*.json'))),128)
                self.assertTrue(path.exists())
                c.atomic_json(path,{'pid':123,'processStart':'old-lifetime','windows':[{'remaining':100}]})
                c.collect({})
                self.assertEqual(json.loads((Path(temp)/'status.json').read_text())['panes'][pane]['windows'],[])

    def test_claude_print_workers_do_not_ambiguate_interactive_session(self):
        from types import SimpleNamespace
        pane = 'w7:p1'
        with patch.object(c.Path, 'stat', return_value=SimpleNamespace(st_uid=c.os.getuid())), patch.object(c.Path, 'read_bytes', return_value=b'HERDR_PANE_ID=w7:p1\0'):
            for argv in [['claude', '--print', '--model', 'opus'], ['claude', '-p', 'prompt'], ['claude', '--print=true']]:
                with self.subTest(argv=argv):
                    self.assertIsNone(c.process_profile({'name': 'claude', 'pid': 123, 'argv': argv}, pane))
            for argv in [['claude', '--resume', 'thread'], ['claude', '--', '--print']]:
                with self.subTest(argv=argv):
                    self.assertEqual(c.process_profile({'name': 'claude', 'pid': 123, 'argv': argv}, pane), ('claude', str(Path.home() / '.claude'), 123))
            self.assertIsNone(c.process_profile({'name': 'claude', 'pid': 123, 'argv': ['claude']}, 'wrong-pane'))
    def test_collector_targets_selected_socket_without_work_session(self):
        from types import SimpleNamespace
        with patch.object(c, 'QUOTA_SOCKET', '/home/example/.config/herdr/herdr.sock'), patch.object(c.subprocess, 'run', return_value=SimpleNamespace(stdout=b'{"result":{}}')) as run:
            self.assertEqual(c.herdr('pane', 'list'), {})
            self.assertEqual(run.call_args.args[0], ['/usr/local/bin/herdr', 'pane', 'list'])
            self.assertEqual(run.call_args.kwargs['env']['HERDR_SOCKET_PATH'], '/home/example/.config/herdr/herdr.sock')
        with patch.object(c, 'QUOTA_SOCKET', None), patch.object(c.subprocess, 'run', return_value=SimpleNamespace(stdout=b'{"result":{}}')) as run:
            c.herdr('pane', 'list')
            self.assertEqual(run.call_args.args[0], ['/usr/local/bin/herdr', '--session', 'work', 'pane', 'list'])

    def test_codex_multiple_buckets_and_missing_weekly(self):
        result = c.codex_windows({'rateLimitsByLimitId': {
            'codex': {'primary': {'usedPercent': 45, 'windowDurationMins': 300, 'resetsAt': 123}},
            'other': {'secondary': {'usedPercent': 0, 'windowDurationMins': 10080}}
        }})
        self.assertEqual([w['remaining'] for w in result], [55, 100])
        self.assertEqual([w['minutes'] for w in result], [300, 10080])
        self.assertIsNone(result[1]['resetsAt'])

    def test_invalid_and_overspent_windows(self):
        for used in [None, '10', float('nan'), True, -1]:
            self.assertIsNone(c.window({'usedPercent': used}, 300, 'codex'))
        self.assertEqual(c.window({'usedPercent': 105}, 300, 'codex')['remaining'], 0)
        self.assertEqual(c.codex_windows({'rateLimits': {}}), [])

    def test_claude_missing_and_reported(self):
        self.assertEqual(c.claude_windows({}), [])
        result = c.claude_windows({'rate_limits': {'seven_day': {'used_percentage': 22, 'resets_at': 123}}})
        self.assertEqual(result, [{'bucket': 'claude', 'minutes': 10080, 'remaining': 78, 'resetsAt': 123}])

    def test_credit_balances_and_reset_inventory_keep_unknown_distinct_from_zero(self):
        home = '/profile'
        raw = {'accountId': 'account', 'rateLimits': {'credits': {'balance': '123.50', 'hasCredits': True, 'unlimited': False}},
               'rateLimitResetCredits': {'availableCount': 2, 'credits': [
                   {'id': 'one', 'status': 'available', 'resetType': 'codexRateLimits', 'expiresAt': 2000000000},
                   {'id': 'two', 'status': 'available', 'resetType': 'codexRateLimits', 'expiresAt': None}]}}
        result = c.codex_extras(raw, home)
        self.assertEqual(result['credits'][0]['balance'], '123.50')
        self.assertTrue(result['bankedResets']['credits'][0]['expiryKnown'])
        self.assertIsNone(result['bankedResets']['credits'][1]['expiresAt'])
        self.assertEqual(len(result['accountKey']), 64)
        self.assertNotEqual(result['accountKey'], c.codex_extras(raw, '/different-profile')['accountKey'])
        self.assertIsNone(c.codex_extras({}, home)['bankedResets'])
        self.assertEqual(c.codex_extras({'rateLimitResetCredits': {'availableCount': 0, 'credits': []}}, home)['bankedResets'],
                         {'availableCount': 0, 'credits': []})
        count_only = c.codex_extras({'rateLimitResetCredits': {'availableCount': 3}}, home)['bankedResets']
        self.assertIsNone(count_only['credits'])
        self.assertIsNone(c.codex_extras({'rateLimitResetCredits': {'availableCount': True}}, home)['bankedResets'])

    def test_background_reader_cannot_redeem_resets(self):
        reader = object.__new__(c.CodexReader)
        reader.allow_reset = False
        with self.assertRaises(AssertionError):
            reader.call('account/rateLimitResetCredit/consume', {'idempotencyKey': 'test'})

    def test_only_explicit_account_client_restores_its_own_address_space_limit(self):
        from types import SimpleNamespace
        for explicit in (False, True):
            with patch.object(c.subprocess, 'Popen', return_value=SimpleNamespace(stdout=object())) as popen, patch.object(c.selectors, 'DefaultSelector'):
                c.CodexReader('/profile', allow_reset=explicit)
                command = popen.call_args.args[0]
                self.assertEqual(command[-1], 'app-server')
                self.assertEqual(command[0] == '/usr/bin/prlimit', explicit)
                self.assertNotIn('preexec_fn', popen.call_args.kwargs)

    def test_expanded_quota_stays_bounded_and_preserves_authoritative_reset_count(self):
        value = {'windows': [], 'bankedResets': {'availableCount': 100, 'credits': [{'id': str(i), 'description': 'x' * 600} for i in range(40)]}}
        result = c.bounded_quota(value)
        import json
        self.assertLessEqual(len(json.dumps(result).encode()), 6500)
        self.assertEqual(result['bankedResets']['availableCount'], 100)
        self.assertEqual(len(value['bankedResets']['credits']), 40)

    def test_no_arbitrary_process_or_user_fallback(self):
        self.assertIsNone(c.process_profile({'pid': 1, 'name': 'bash'}, 'w1:p1'))
        from types import SimpleNamespace
        with patch.object(c.os, 'getuid', return_value=-999), patch.object(c.Path, 'stat', return_value=SimpleNamespace(st_uid=1000)):
            self.assertIsNone(c.process_profile({'pid': 1, 'name': 'codex'}, 'w1:p1'))

if __name__ == '__main__':
    unittest.main()
