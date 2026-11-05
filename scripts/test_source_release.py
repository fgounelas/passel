import importlib.util
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('source_release', Path(__file__).with_name('source-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class SourceRelease(unittest.TestCase):
    def fixture(self, root, include=None):
        source = root / 'source'; source.mkdir()
        (source / 'source-release.json').write_text(json.dumps({'include': include or ['README.md']}))
        (source / 'README.md').write_text('Generic source documentation\n')
        return source

    def test_exports_only_reviewed_files_without_history_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = self.fixture(root)
            (source / '.git').mkdir(); (source / '.git/config').write_text('private history')
            (source / '.env').write_text('local credentials')
            output = root / 'clean'
            self.assertEqual(release.export(source, output), 1)
            self.assertEqual(set(p.name for p in output.iterdir()), {'README.md', release.MANIFEST})
            self.assertEqual(release.audit(output), 1)
            with self.assertRaises(ValueError): release.export(source, output)
            (output / 'README.md').write_text('changed after audit')
            with self.assertRaises(ValueError): release.audit(output)

    def test_private_identifiers_secrets_symlinks_and_operational_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = self.fixture(root)
            patterns = [('local identifier', re.compile('private-host-example'))]
            for text in ['private-host-example', 'ghp_' + 'x' * 36, '-----BEGIN ' + 'PRIVATE KEY-----']:
                (source / 'README.md').write_text(text)
                with self.assertRaises(ValueError): release.export(source, root / 'clean', patterns)
                self.assertFalse((root / 'clean').exists())
            (source / 'README.md').unlink(); (source / 'README.md').symlink_to(source / '.env')
            (source / '.env').write_text('do not copy')
            with self.assertRaises(ValueError): release.export(source, root / 'clean')
            (source / 'source-release.json').write_text(json.dumps({'include': ['.env']}))
            with self.assertRaises(ValueError): release.export(source, root / 'clean')

    def test_removes_png_metadata_and_rejects_unexpected_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = self.fixture(root)
            release.export(source, root / 'clean')
            (root / 'clean/.env').write_text('new private file')
            with self.assertRaises(ValueError): release.audit(root / 'clean')
        def chunk(kind, value):
            import zlib
            return len(value).to_bytes(4, 'big') + kind + value + zlib.crc32(kind + value).to_bytes(4, 'big')
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', b'x') + chunk(b'tEXt', b'private metadata') + chunk(b'IEND', b'')
        self.assertNotIn(b'private metadata', release.clean_png(png))

    def test_manifest_detects_changed_and_new_source_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = self.fixture(Path(tmp), ['*.md'])
            with self.assertRaises(ValueError): release.sync_manifest(source, check=True)
            self.assertEqual(release.sync_manifest(source), 1)
            self.assertEqual(release.sync_manifest(source, check=True), 1)
            (source / 'README.md').write_text('Updated documentation\n')
            with self.assertRaises(ValueError): release.sync_manifest(source, check=True)
            (source / 'CHANGELOG.md').write_text('Release notes\n')
            self.assertEqual(release.sync_manifest(source), 2)
            data = json.loads((source / release.MANIFEST).read_text())
            self.assertEqual(data['files']['README.md'], hashlib.sha256((source / 'README.md').read_bytes()).hexdigest())
            output = Path(tmp) / 'export'
            release.export(source, output)
            self.assertEqual((source / release.MANIFEST).read_bytes(), (output / release.MANIFEST).read_bytes())

    def test_manifest_validation_failure_preserves_previous_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = self.fixture(Path(tmp))
            release.sync_manifest(source)
            previous = (source / release.MANIFEST).read_bytes()
            (source / 'README.md').write_text('ghp_' + 'x' * 36)
            with self.assertRaises(ValueError): release.sync_manifest(source)
            self.assertEqual((source / release.MANIFEST).read_bytes(), previous)

    def test_manifest_refuses_unreviewed_png_metadata_and_output_symlinks(self):
        import zlib
        def chunk(kind, value):
            return len(value).to_bytes(4, 'big') + kind + value + zlib.crc32(kind + value).to_bytes(4, 'big')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = self.fixture(root, ['README.md', '*.png'])
            png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', b'x') + chunk(b'tEXt', b'private metadata') + chunk(b'IEND', b'')
            (source / 'image.png').write_bytes(png)
            with self.assertRaises(ValueError): release.sync_manifest(source)
            (source / 'image.png').write_bytes(release.clean_png(png))
            external = root / 'external'; external.write_text('preserve')
            (source / release.MANIFEST).symlink_to(external)
            with self.assertRaises(ValueError): release.sync_manifest(source)
            self.assertEqual(external.read_text(), 'preserve')
