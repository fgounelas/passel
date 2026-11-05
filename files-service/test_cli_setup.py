import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from cli_setup import CLIS, CliSetup
from setup import SetupError
from server import Server


class CliSetupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='passel-cli-test-')
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name) / 'home with spaces'
        self.home.mkdir()
        with patch.dict(os.environ, {'PATH': '/usr/bin:/bin'}):
            self.setup = CliSetup(self.home, self.home / 'private state')

    def binary(self, name, version):
        target = self.setup.bin / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f'#!/bin/sh\n[ "$1" = --version ] || exit 64\nprintf "{version}\\n"\n')
        target.chmod(0o700)
        return target

    def fixture_installer(self, name, version):
        return (f'#!/bin/sh\nmkdir -p "$HOME/.local/bin"\n'
                f'cat > "$HOME/.local/bin/{name}" <<\'CLI\'\n'
                f'#!/bin/sh\n[ "$1" = --version ] || exit 64\nprintf "{version}\\n"\n'
                f'CLI\nchmod +x "$HOME/.local/bin/{name}"\n')

    def test_status_only_reads_versions_and_does_not_create_state(self):
        self.assertTrue(all(not item['installed'] for item in self.setup.status()['clis']))
        self.assertFalse(self.setup.state.exists())
        self.binary('codex', 'codex-cli 1.2.3-beta.1')
        items = {item['id']: item for item in self.setup.status()['clis']}
        self.assertEqual(items['codex']['version'], '1.2.3-beta.1')
        self.assertFalse(self.setup.state.exists())
        self.binary('codex', 'codex-cli 2.0.0')
        self.assertEqual(self.setup.cli('codex')['version'], '2.0.0')

    def test_only_allowlisted_noninteractive_installs_and_real_update_actions_are_used(self):
        keep = self.home / '.codex/auth.json'
        keep.parent.mkdir(); keep.write_text('synthetic credentials: preserve')
        original = self.setup.execute
        calls = []
        desired = '1.0.0'
        def execute(command, timeout, **kwargs):
            calls.append(command)
            if '--output' in command:
                name = next(key for key, value in CLIS.items() if value[0] == command[-1])
                Path(command[command.index('--output') + 1]).write_text(self.fixture_installer(name, desired))
                return subprocess.CompletedProcess(command, 0, '', '')
            if command[-1] == 'update':
                self.assertEqual(command, [str(self.setup.bin / 'agy'), 'update'])
                self.binary('agy', desired)
                return subprocess.CompletedProcess(command, 0, '', '')
            return original(command, timeout, **kwargs)
        with patch.object(self.setup, 'execute', side_effect=execute):
            for name in CLIS:
                desired = '1.0.0'
                self.assertEqual(self.setup.change(name, 'install')['version'], desired)
                count = len(calls)
                self.setup.change(name, 'install')
                self.assertEqual(len(calls), count)  # Install never silently updates an existing CLI.
                desired = '2.0.0'
                self.assertEqual(self.setup.change(name, 'update')['version'], desired)
        urls = [command[-1] for command in calls if '--output' in command]
        self.assertEqual(urls.count(CLIS['agy'][0]), 1)
        self.assertEqual(urls.count(CLIS['claude'][0]), 2)
        self.assertEqual(urls.count(CLIS['codex'][0]), 2)
        self.assertEqual(keep.read_text(), 'synthetic credentials: preserve')
        self.assertFalse(list((self.setup.state / 'cli-installs').glob('.download-*')))
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600
                            for path in (self.setup.state / 'cli-installs').glob('*.log')))

    def test_unknown_inputs_do_not_create_files_or_run_commands(self):
        for name, action in [('other', 'install'), ('codex; touch injected', 'install'),
                             ('codex', 'login'), ('codex', []), ([], 'install'),
                             ('https://example.test/install.sh', 'install')]:
            with self.subTest(name=name, action=action), self.assertRaises(SetupError):
                self.setup.change(name, action)
        self.assertFalse(self.setup.state.exists())

    def test_child_environment_excludes_credentials_profiles_and_shell_hooks(self):
        with patch.dict(os.environ, {'CODEX_HOME': '/other/profile', 'OPENAI_API_KEY': 'synthetic-secret',
                                    'ANTHROPIC_API_KEY': 'synthetic-secret', 'GEMINI_API_KEY': 'synthetic-secret',
                                    'BASH_ENV': '/other/hook', 'NODE_OPTIONS': '--require /other/hook',
                                    'CODEX_INSTALLER_USE_RELEASES_OPENAI_COM': 'false'}):
            environment = self.setup.environment()
        self.assertEqual(environment['CODEX_HOME'], str(self.home / '.codex'))
        self.assertEqual(environment['CODEX_NON_INTERACTIVE'], '1')
        self.assertTrue(environment['PATH'].startswith(str(self.setup.bin)))
        self.assertFalse(any(key in environment for key in ('OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
                                                           'GEMINI_API_KEY', 'BASH_ENV', 'NODE_OPTIONS',
                                                           'CODEX_INSTALLER_USE_RELEASES_OPENAI_COM')))

    def test_failure_preserves_existing_cli_and_only_returns_a_safe_error(self):
        self.binary('codex', '1.0.0')
        with patch.object(self.setup, 'execute', side_effect=[
                subprocess.CompletedProcess([], 0, '1.0.0', ''),
                subprocess.CompletedProcess([], 22, 'synthetic private output', '')]):
            with self.assertRaises(SetupError) as error:
                self.setup.change('codex', 'update')
        self.assertEqual(error.exception.status, 502)
        status = self.setup.status()
        self.assertEqual(status['clis'][1]['version'], '1.0.0')
        self.assertIn('could not be downloaded', status['clis'][1]['error'])
        self.assertNotIn('synthetic private output', json.dumps(status))
        self.assertIsNone(self.setup.active)

    def test_cross_process_lock_prevents_overlapping_installers(self):
        self.setup.state.mkdir()
        with (self.setup.state / '.cli-install.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            other = CliSetup(self.home, self.setup.state)
            with self.assertRaises(SetupError) as error:
                other.change('codex', 'install')
            self.assertEqual(error.exception.status, 409)
            self.assertFalse((self.setup.state / 'cli-installs').exists())

    def test_timeout_reaps_only_the_owned_command(self):
        with self.assertRaises(SetupError) as error:
            self.setup.execute(['/bin/sh', '-c', 'sleep 10'], timeout=0.05)
        self.assertEqual(error.exception.status, 504)

    def test_http_requires_gateway_origin_marker_and_exact_allowlisted_cli_payload(self):
        server = Server(('127.0.0.1', 0), {}, 'k' * 40, 'https://example.test')
        server.cli_setup = self.setup
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def request(value=None, headers=None, method=None):
            values = {'X-Herdr-Gateway': 'k' * 40, 'Origin': 'https://example.test',
                      'Content-Type': 'application/json', 'X-Herdr-Setup': '1', **(headers or {})}
            try:
                response = urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/project-files/setup/clis',
                                          data=None if value is None else json.dumps(value).encode(),
                                          headers=values, method=method), timeout=3)
            except HTTPError as error:
                response = error
            with response:return response.status, json.load(response)
        try:
            self.assertEqual(request()[0], 200)
            for headers in ({'X-Herdr-Setup': ''}, {'Origin': 'https://foreign.test'}, {'X-Herdr-Gateway': ''}):
                self.assertEqual(request({'cli': 'codex', 'action': 'install'}, headers)[0], 403)
            for payload in ({'cli': []}, {'cli': 'codex', 'action': []}, {'cli': 'other', 'action': 'install'},
                            {'cli': 'codex', 'action': 'install', 'url': 'https://example.test'}):
                self.assertEqual(request(payload)[0], 400)
            self.assertEqual(request({'cli': 'codex', 'action': 'install'}, method='DELETE')[0], 405)
            self.assertFalse(self.setup.state.exists())
            with patch.object(self.setup, 'change', return_value={'id': 'codex', 'version': '1.2.3'}) as change:
                self.assertEqual(request({'cli': 'codex', 'action': 'install'}), (200, {'id': 'codex', 'version': '1.2.3'}))
                change.assert_called_once_with('codex', 'install')
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
