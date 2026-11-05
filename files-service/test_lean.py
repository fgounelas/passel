import os
from pathlib import Path
import tempfile
import unittest
from server import Files


class LeanFiles(unittest.TestCase):
    def test_listing_search_and_direct_access_share_source_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            names = ['README.md', 'projects/example/README.md', 'projects/example/PROBLEM.md', 'projects/example/Main.lean',
                     'projects/example/Proofs/Result.lean', 'projects/example/lakefile.toml',
                     'projects/example/lake-manifest.json', 'projects/example/lean-toolchain',
                     'projects/example/paper.pdf', 'projects/example/notes.txt']
            blocked = ['tools/Tool.lean', 'projects/example/.lake/Dependency.lean',
                       'projects/example/build/Generated.lean', 'projects/example/private.json',
                       'projects/example/Main.olean', 'projects/example/.secret.md',
                       'projects/example/run.sh', 'projects/example/nested/lakefile.toml']
            for name in names + blocked:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text('source')
            (root/'projects/example/link.lean').symlink_to(root/'README.md')
            (root/'projects/example/escape').symlink_to(root, target_is_directory=True)
            os.mkfifo(root/'projects/example/pipe.lean')
            files = Files({'lean': str(root)})
            self.addCleanup(files.close)
            self.assertEqual({e['name'] for e in files.listing('work', 'lean')}, {'projects', 'README.md'})
            for name in names:
                with os.fdopen(files.open('work', 'lean/' + name)) as f:
                    self.assertEqual(f.read(), 'source')
            for name in blocked + ['projects/example/link.lean', 'projects/example/pipe.lean',
                                   'projects/example/escape/README.md', '../README.md']:
                for key, path in [('lean', name), ('work', 'lean/' + name)]:
                    with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                        files.open(key, path)
            for path in ['tools', 'projects/example/.lake', 'projects/example/build']:
                with self.assertRaises((ValueError, OSError)):
                    files.listing('work', 'lean/' + path)
            found = files.search('work', '.lean')
            self.assertFalse(found['truncated'])
            self.assertEqual({e['path'] for e in found['entries']},
                             {'lean/projects/example/Main.lean', 'lean/projects/example/Proofs/Result.lean'})
