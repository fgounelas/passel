import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from setup import PROJECTS, Setup, SetupError
from server import Server


class SetupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        self.setup = Setup(self.home, self.home / 'private-state')

    def test_status_is_read_only_and_missing_projects_are_distinct(self):
        status = self.setup.status()
        self.assertEqual(status['startup_path'], '~/work')
        self.assertEqual([(p['id'], p['status']) for p in status['projects']], [('danus', 'missing'), ('pharos', 'missing')])
        self.assertFalse(self.setup.work.exists())
        self.assertFalse(self.setup.state.exists())

    def fake_clone(self, *args, **kwargs):
        if args[0] != 'clone':
            return self.original_git(*args, **kwargs)
        self.clone_calls.append(args)
        destination = Path(args[-1])
        subprocess.run(['git', 'init', '--quiet', '--template=', str(destination)], check=True)
        subprocess.run(['git', '-C', str(destination), 'config', 'remote.origin.url', args[-2]], check=True)
        (destination / 'README.md').write_text('Synthetic checkout')
        return subprocess.CompletedProcess(args, 0, '', '')

    def test_only_known_latest_default_branch_clones_are_installed_and_never_updated(self):
        self.original_git = self.setup.git
        self.clone_calls = []
        self.setup.work.mkdir()
        (self.setup.work / 'danus').mkdir()
        with patch.object(self.setup, 'git', side_effect=self.fake_clone):
            for name in PROJECTS:
                self.assertEqual(self.setup.install(name)['status'], 'installed')
                readme = self.setup.work / name / 'README.md'
                readme.write_text('User edits')
                self.assertEqual(self.setup.install(name)['status'], 'installed')
                self.assertEqual(readme.read_text(), 'User edits')
        self.assertEqual(len(self.clone_calls), 2)
        for call, name in zip(self.clone_calls, PROJECTS):
            self.assertIn('--single-branch', call)
            self.assertIn('--no-recurse-submodules', call)
            self.assertNotIn('--branch', call)
            self.assertEqual(call[-2], PROJECTS[name])

    def test_existing_files_symlinks_and_unknown_inputs_are_never_replaced(self):
        target = self.setup.work / 'danus'
        target.mkdir(parents=True)
        (target / 'proof.md').write_text('Keep this')
        with self.assertRaises(SetupError) as error:
            self.setup.install('danus')
        self.assertEqual(error.exception.status, 409)
        self.assertEqual((target / 'proof.md').read_text(), 'Keep this')
        (self.setup.work / 'pharos').symlink_to(target, target_is_directory=True)
        with self.assertRaises(SetupError):
            self.setup.install('pharos')
        for invalid in [[], {}, None, 'other', '../danus', 'https://example.test/repo']:
            with self.subTest(invalid=invalid), self.assertRaises(SetupError):
                self.setup.install(invalid)

    def test_clone_failure_cleans_only_its_own_temporary_directory(self):
        target = self.setup.work / 'danus'
        target.mkdir(parents=True)
        with patch.object(self.setup, 'git', return_value=subprocess.CompletedProcess([], 1, '', 'network error')):
            with self.assertRaises(SetupError):
                self.setup.install('danus')
        self.assertEqual(list(self.setup.work.iterdir()), [target])
        self.assertEqual(list(target.iterdir()), [])

    def test_concurrent_new_files_and_another_install_are_preserved(self):
        self.setup.work.mkdir()
        def clone(*_args, **_kwargs):
            target = self.setup.work / 'danus'
            target.mkdir()
            (target / 'new.md').write_text('Created during clone')
            return subprocess.CompletedProcess([], 0, '', '')
        with patch.object(self.setup, 'git', side_effect=clone), self.assertRaises(SetupError):
            self.setup.install('danus')
        self.assertEqual((self.setup.work / 'danus/new.md').read_text(), 'Created during clone')
        with self.setup.install_lock, self.assertRaises(SetupError):
            self.setup.install('pharos')

    def test_startup_path_is_validated_persistent_and_private(self):
        self.assertEqual(self.setup.set_startup_path('~/work'), {'startup_path': '~/work'})
        custom = self.home / 'work/Folder with spaces'
        custom.mkdir()
        self.setup.set_startup_path(str(custom))
        self.assertEqual(Setup(self.home, self.setup.state).startup_path(), str(custom))
        self.assertEqual(self.setup.settings.stat().st_mode & 0o777, 0o600)
        before = self.setup.settings.read_bytes()
        for invalid in ['', '../outside', '~/../outside', 'relative', '~/missing', '/missing\npath', [], None]:
            with self.subTest(invalid=invalid), self.assertRaises(SetupError):
                self.setup.set_startup_path(invalid)
        self.assertEqual(self.setup.settings.read_bytes(), before)

    def test_http_setup_requires_gateway_origin_marker_and_exact_payload(self):
        server = Server(('127.0.0.1', 0), {}, 'k' * 40, 'https://example.test')
        server.setup = self.setup
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def request(value=None, headers=None, method=None):
            values = {'X-Herdr-Gateway': 'k' * 40, 'Origin': 'https://example.test',
                      'Content-Type': 'application/json', 'X-Herdr-Setup': '1', **(headers or {})}
            try:
                response = urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/project-files/setup',
                                          data=None if value is None else json.dumps(value).encode(),
                                          headers=values, method=method), timeout=3)
            except HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response)
        try:
            self.assertEqual(request()[0], 200)
            self.assertEqual(request({'startup_path': '~/work'}, {'X-Herdr-Setup': ''})[0], 403)
            self.assertEqual(request({'startup_path': '~/work'}, {'Origin': 'https://foreign.test'})[0], 403)
            self.assertEqual(request({'startup_path': '~/work'}, {'X-Herdr-Gateway': ''})[0], 403)
            self.assertEqual(request({'project': [], 'url': 'https://example.test'})[0], 400)
            self.assertEqual(request({'project': []})[0], 400)
            self.assertEqual(request({'project': 'danus'}, method='DELETE')[0], 405)
            self.assertEqual(request({'startup_path': '~/work'}), (200, {'startup_path': '~/work'}))
            self.assertEqual(request()[1]['startup_path'], '~/work')
        finally:
            server.shutdown(); server.server_close(); thread.join()
