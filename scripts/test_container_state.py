import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


entrypoint = load('container_state_entrypoint', ROOT / 'docker/entrypoint.py')


class ContainerStateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name)
        self.state = self.home / 'containers/passel'
        self.legacy = self.home / 'containers/herdr-web'
        patched = patch.multiple(entrypoint, RESEARCH_HOME=self.home, STATE=self.state)
        patched.start()
        self.addCleanup(patched.stop)

    def test_fresh_home_does_not_create_a_legacy_alias(self):
        entrypoint.migrate_legacy_state()
        self.assertFalse(self.legacy.exists())
        self.assertFalse(self.legacy.is_symlink())

    def test_empty_legacy_directory_moves_without_an_alias(self):
        self.legacy.mkdir(parents=True)
        entrypoint.migrate_legacy_state()
        self.assertTrue(self.state.is_dir())
        self.assertFalse(self.legacy.exists())
        self.assertFalse(self.legacy.is_symlink())

    def test_saved_data_and_absolute_launcher_paths_survive_migration_and_restart(self):
        launcher = self.legacy / 'conversation-state/launchers/example/claude'
        launcher.parent.mkdir(parents=True)
        binary = self.home / 'claude'
        binary.write_text('synthetic executable')
        launcher.symlink_to(binary)
        bookmarks = self.legacy / 'conversation-state/bookmarks.sqlite'
        bookmarks.write_bytes(b'synthetic saved state')
        entrypoint.migrate_legacy_state()
        entrypoint.migrate_legacy_state()
        self.assertTrue(self.legacy.is_symlink())
        self.assertTrue(self.legacy.samefile(self.state))
        self.assertTrue(launcher.samefile(binary))
        self.assertEqual((self.state / 'conversation-state/bookmarks.sqlite').read_bytes(), b'synthetic saved state')

    def test_two_existing_state_directories_are_not_overwritten(self):
        for directory in (self.state, self.legacy):
            directory.mkdir(parents=True)
            (directory / 'saved').write_text(directory.name)
        with self.assertRaises(ValueError):
            entrypoint.migrate_legacy_state()
        for directory in (self.state, self.legacy):
            self.assertEqual((directory / 'saved').read_text(), directory.name)

    def test_explicit_custom_state_leaves_legacy_data_untouched(self):
        self.legacy.mkdir(parents=True)
        with patch.object(entrypoint, 'STATE', self.home / 'custom-state'):
            entrypoint.migrate_legacy_state()
        self.assertTrue(self.legacy.is_dir())
        self.assertFalse(self.legacy.is_symlink())

    def test_observers_and_resume_launcher_share_the_configured_state(self):
        with patch.dict(os.environ, {'PASSEL_STATE_DIR': str(self.state)}), \
                patch.object(sys, 'path', [str(ROOT / 'conversation-service'), *sys.path]):
            conversations = load('container_conversations', ROOT / 'conversation-service/collector.py')
            usage = load('container_usage', ROOT / 'usage-service/collector.py')
            lifecycle = load('container_lifecycle', ROOT / 'conversation-service/tab_lifecycle.py')
            self.assertEqual(conversations.BASE, self.state)
            self.assertEqual(usage.BASE, self.state)
            self.assertTrue(lifecycle.claude_launcher_path('/example/claude').is_relative_to(
                self.state / 'conversation-state/launchers'))


if __name__ == '__main__':
    unittest.main()
