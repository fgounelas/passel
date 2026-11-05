import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import time
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from server import Files, Server, byte_range, components


class FileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.out = self.root / 'project' / 'papers'
        self.out.mkdir(parents=True)
        (self.out / 'main.tex').write_text('math')
        (self.out / 'main.pdf').write_bytes(b'%PDF-1.7\nexample')
        (self.out / 'private.env').write_text('secret')
        (self.out / '.hidden.md').write_text('secret')
        (self.root / 'secret.md').write_text('secret')
        (self.root / 'project' / 'runtime').mkdir()
        self.files = Files({'danus': str(self.root)})

    def tearDown(self):
        self.files.close()
        self.temp.cleanup()

    def test_workflow_projects_created_after_service_start_become_visible(self):
        work = self.root / 'fresh-work'
        roots = {name: str(work / name / 'runtime/projects') for name in ('danus', 'pharos')}
        for name in roots:
            (work / name).mkdir(parents=True)
        files = Files(roots, work_dir=str(work))
        try:
            for name in roots:
                self.assertEqual(list((work / name).iterdir()), [])
                self.assertEqual(files.listing('work', name + '/runtime/projects'), [])
            self.assertEqual(files.search('work', 'fact.md'), {'entries': [], 'truncated': False})
            for name, path in roots.items():
                project = Path(path) / 'example'
                facts = project / 'fact_graph/facts'
                facts.mkdir(parents=True)
                (facts / 'fact.md').write_text('Synthetic fact')
                (project / 'private.md').write_text('Hidden runtime data')
                expected = name + '/runtime/projects/example/fact_graph/facts/fact.md'
                with os.fdopen(files.open('work', expected)) as opened:
                    self.assertEqual(opened.read(), 'Synthetic fact')
                self.assertIn(expected, [e['path'] for e in files.search('work', 'fact.md')['entries']])
            self.assertEqual(files.search('work', 'private.md')['entries'], [])
        finally:
            files.close()

    def test_missing_workflow_root_rejects_a_later_symlink(self):
        missing = self.root / 'later-projects'
        files = Files({'danus': str(missing)})
        try:
            self.assertEqual(files.listing('danus', ''), [])
            missing.symlink_to(self.root, target_is_directory=True)
            with self.assertRaises(OSError):
                files.listing('danus', '')
            with self.assertRaises(OSError):
                files.open('danus', 'project/papers/main.tex')
        finally:
            files.close()

    def test_scope(self):
        self.assertEqual([e['name'] for e in self.files.listing('danus', 'project')], ['papers'])
        self.assertEqual([e['name'] for e in self.files.listing('danus', 'project/papers')], ['main.pdf', 'main.tex'])
        for path in ['/etc/passwd', '../secret.md', 'project/papers/../secret.md', 'project/runtime/x.md',
                     'project/papers/.hidden.md', 'project/papers/private.env', 'project//papers/a.md',
                     'project/papers/a\\b.md', 'project/papers/a\x00.md']:
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                self.files.open('danus', path)

    def test_ordinary_work_folders_keep_structure_files_and_timestamps_without_workflow_or_alias_escape(self):
        work = self.root/'work';work.mkdir()
        example = work/'Example';example.mkdir()
        (example/'drafts').mkdir();(example/'drafts/main.tex').write_text('paper')
        (example/'AGENTS.md').write_text('instructions')
        (example/'artifact.bin').write_bytes(b'\x00binary')
        (example/'.claude').mkdir();(example/'.claude/auth.json').write_text('private')
        (example/'alias.md').symlink_to(self.root/'secret.md')
        os.mkfifo(example/'pipe')
        (work/'outside').symlink_to(self.root, target_is_directory=True)
        (work/'loose.tex').write_text('root file')
        for name in ('danus-mine', 'my-PHAROS-copy', 'Rethlas-dev'):
            (work/name).mkdir();(work/name/'config.md').write_text('workflow internals')
        files=Files({'danus':str(self.root)},work_dir=str(work))
        try:
            entries=files.listing('work','')
            self.assertEqual([e['name'] for e in entries],['danus','Example'])
            self.assertGreater(next(e for e in entries if e['name']=='Example')['mtime'],0)
            self.assertEqual([e['name'] for e in files.listing('work','Example')],['drafts','AGENTS.md','artifact.bin'])
            for path in ('Example/AGENTS.md','Example/drafts/main.tex','Example/artifact.bin'):
                with os.fdopen(files.open('work',path),'rb') as opened:
                    self.assertTrue(opened.read())
            self.assertIn('Example/drafts/main.tex',{e['path'] for e in files.search('work','main.tex')['entries']})
            for path in ('loose.tex','Example/.claude/auth.json','Example/alias.md','Example/pipe','outside/secret.md',
                         'Example/../secret.md','danus-mine/config.md','my-PHAROS-copy/config.md','Rethlas-dev/config.md'):
                with self.subTest(path=path),self.assertRaises((ValueError,OSError,KeyError)):
                    files.open('work',path)
        finally:
            files.close()

    def test_http_ordinary_source_is_plain_text_and_unknown_binary_is_download_only(self):
        work=self.root/'ordinary-work';(work/'Example').mkdir(parents=True)
        (work/'Example/page.html').write_text('<script>alert(1)</script>')
        (work/'Example/blob.bin').write_bytes(b'\x00binary')
        server=Server(('127.0.0.1',0),{},'x'*64,'https://example.test',work_dir=str(work),work_host_dir='/home/example/work')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with urlopen(Request(f'http://127.0.0.1:{server.server_port}/api/project-files/roots',
                                 headers={'X-Herdr-Gateway':'x'*64}),timeout=3) as response:
                self.assertEqual(json.load(response),{'roots':['work'],'paths':{'work':'/home/example/work'}})
            for name,content_type,disposition in [('page.html','text/plain; charset=utf-8','inline;'),
                                                  ('blob.bin','application/octet-stream','attachment;')]:
                url=f'http://127.0.0.1:{server.server_port}/api/project-files/content?root=work&path=Example/{name}'
                with urlopen(Request(url,headers={'X-Herdr-Gateway':'x'*64}),timeout=3) as response:
                    self.assertEqual(response.headers['Content-Type'],content_type)
                    self.assertTrue(response.headers['Content-Disposition'].startswith(disposition))
                    self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
                    self.assertEqual(response.read(),(work/'Example'/name).read_bytes())
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_research_output_directories(self):
        for folder in ['audits', 'advisories', 'research']:
            with self.subTest(folder=folder):
                directory = self.root / 'project' / folder / 'topic'
                directory.mkdir(parents=True)
                for name in ['report.md', 'paper.tex', 'paper.pdf', 'checker.py', 'reading.html', '.hidden.md']:
                    (directory / name).write_text('output')
                (directory / 'alias.md').symlink_to(self.root / 'secret.md')
                path = 'project/' + folder + '/topic'
                self.assertEqual({e['name'] for e in self.files.listing('danus', path)},
                                 {'report.md', 'paper.tex', 'paper.pdf'})
                with os.fdopen(self.files.open('work', 'danus/runtime/projects/' + path + '/report.md')) as opened:
                    self.assertEqual(opened.read(), 'output')
                self.assertIn(path + '/report.md', [e['path'] for e in self.files.search('danus', 'report')['entries']])
                for name in ['checker.py', 'reading.html', '.hidden.md', 'alias.md']:
                    with self.assertRaises((ValueError, OSError)):
                        self.files.open('danus', path + '/' + name)
        for folder in ['references', 'inputs', 'workers', 'global_memory']:
            with self.assertRaises(ValueError):
                self.files.open('danus', 'project/' + folder + '/report.md')

    def test_ops_outputs_and_scope(self):
        folder = self.root / 'project' / 'ops'
        folder.mkdir()
        name = 'SHUTDOWN-AUDIT-2026-09-15T1614Z.md'
        (folder / name).write_text('audit')
        (folder / 'private.env').write_text('secret')
        (folder / '.hidden.md').write_text('secret')
        (folder / 'link.md').symlink_to(self.root / 'secret.md')
        self.assertEqual([e['name'] for e in self.files.listing('danus', 'project/ops')], [name])
        with os.fdopen(self.files.open('work', 'danus/runtime/projects/project/ops/' + name)) as opened:
            self.assertEqual(opened.read(), 'audit')
        self.assertIn('project/ops/' + name, [e['path'] for e in self.files.search('danus', 'SHUTDOWN')['entries']])
        for name in ['private.env', '.hidden.md', 'link.md']:
            with self.assertRaises((ValueError, OSError)):
                self.files.open('danus', 'project/ops/' + name)

    def test_plans_and_run_records(self):
        plans = self.root / 'project' / 'plans'
        plans.mkdir()
        (plans / 'audit.md').write_text('audit')
        (self.root / 'project' / 'RUN-2026-09-14.md').write_text('handoff')
        (self.root / 'project' / 'private.md').write_text('private')
        self.assertIn('RUN-2026-09-14.md', [e['name'] for e in self.files.listing('danus', 'project')])
        for path in ['project/plans/audit.md', 'project/RUN-2026-09-14.md']:
            with os.fdopen(self.files.open('danus', path)) as opened:
                self.assertTrue(opened.read())
        for path in ['project/private.md', 'project/RUN-secret.md']:
            with self.assertRaises(ValueError):
                self.files.open('danus', path)
        self.assertIn('project/RUN-2026-09-14.md', [e['path'] for e in self.files.search('danus', 'RUN-') ['entries']])

    def test_project_problem_documents_list_open_and_search_across_projects(self):
        for project in ['project', 'second']:
            directory = self.root / project
            directory.mkdir(exist_ok=True)
            (directory / 'PROBLEM.md').write_text('Problem for ' + project)
            for name in ['PROBLEM.md.bak', 'private.md']:
                (directory / name).write_text('private')
            self.assertIn('PROBLEM.md', [entry['name'] for entry in self.files.listing('danus', project)])
            for key, path in [('danus', project + '/PROBLEM.md'), ('work', 'danus/runtime/projects/' + project + '/PROBLEM.md')]:
                with os.fdopen(self.files.open(key, path)) as file:
                    self.assertEqual(file.read(), 'Problem for ' + project)
            for name in ['problem.md', 'PROBLEM.md.bak', 'private.md']:
                with self.assertRaises(ValueError):
                    self.files.open('danus', project + '/' + name)
        self.assertEqual({entry['path'] for entry in self.files.search('work', 'problem')['entries']},
                         {'danus/runtime/projects/project/PROBLEM.md', 'danus/runtime/projects/second/PROBLEM.md'})
        (self.root / 'PROBLEM.md').write_text('workspace private')
        with self.assertRaises(ValueError):
            self.files.open('danus', 'PROBLEM.md')

    def test_pharos_outputs_use_the_shared_tree_search_and_secure_document_policy(self):
        folders = ['human_report/md', 'human_report/pdf', 'worker_report/xhigh',
                   'checkpoints', 'materials', 'expert_guidance', 'fact_graph/facts']
        for folder in folders:
            path = self.root / 'project' / folder
            path.mkdir(parents=True, exist_ok=True)
            (path / 'result.md').write_text('Pharos research output')
            (path / 'checker.py').write_text('private implementation')
            (path / 'alias.md').symlink_to(self.root / 'secret.md')
        (self.root / 'project/ROUTES.md').write_text('Research routes')
        (self.root / 'project/PROBLEM.md').write_text('Research problem')
        for folder in ['workers', 'reporter', 'chat', 'computation', 'literature', 'global_memory', '.codex-home']:
            path = self.root / 'project' / folder
            path.mkdir(exist_ok=True)
            (path / 'private.md').write_text('private')
        files = Files({'danus': str(self.root), 'pharos': str(self.root)})
        try:
            self.assertEqual([e['name'] for e in files.listing('work', '')], ['danus', 'pharos'])
            self.assertEqual([e['name'] for e in files.listing('work', 'pharos/runtime')], ['projects'])
            visible = {e['name'] for e in files.listing('work', 'pharos/runtime/projects/project')}
            self.assertEqual(visible, {'human_report', 'worker_report', 'checkpoints', 'materials',
                                       'expert_guidance', 'fact_graph', 'papers', 'PROBLEM.md', 'ROUTES.md'})
            for folder in folders:
                path = 'pharos/runtime/projects/project/' + folder
                self.assertEqual([e['name'] for e in files.listing('work', path)], ['result.md'])
                with os.fdopen(files.open('work', path + '/result.md')) as opened:
                    self.assertEqual(opened.read(), 'Pharos research output')
                for name in ['checker.py', 'alias.md']:
                    with self.assertRaises((ValueError, OSError)):
                        files.open('work', path + '/' + name)
            self.assertEqual({e['path'] for e in files.search('pharos', 'result')['entries']},
                             {'project/' + folder + '/result.md' for folder in folders})
            self.assertIn('pharos/runtime/projects/project/ROUTES.md',
                          {e['path'] for e in files.search('work', 'ROUTES')['entries']})
            for path in ['project/ROUTES.md', 'project/materials/result.md', 'project/worker_report/xhigh/result.md']:
                with self.assertRaises(ValueError):
                    files.open('danus', path)
            for path in ['pharos/config', 'pharos/runtime/codex-npm',
                         'pharos/runtime/projects/project/literature/private.md',
                         'pharos/runtime/projects/project/.codex-home/private.md',
                         'pharos/runtime/projects/project/chat/private.md',
                         'pharos/runtime/projects/project/AGENTS.md',
                         'pharos/runtime/projects/project/ROUTES.md/private.md']:
                with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                    files.open('work', path)
        finally:
            files.close()

    def test_problem_document_rejects_symlinks_special_files_and_directory_aliases(self):
        path = self.root / 'project' / 'PROBLEM.md'
        for kind in ['symlink', 'fifo', 'directory']:
            if kind == 'symlink': path.symlink_to(self.root / 'secret.md')
            elif kind == 'fifo': os.mkfifo(path)
            else: path.mkdir()
            self.assertNotIn('PROBLEM.md', [entry['name'] for entry in self.files.listing('danus', 'project')])
            with self.assertRaises((ValueError, OSError)):
                self.files.open('work', 'danus/runtime/projects/project/PROBLEM.md')
            with self.assertRaises((ValueError, OSError)):
                self.files.listing('danus', 'project/PROBLEM.md')
            if kind == 'directory': path.rmdir()
            else: path.unlink()

    def test_symlinks_fifo_and_swap(self):
        (self.out / 'link.md').symlink_to(self.root / 'secret.md')
        (self.out / 'escape').symlink_to(self.root, target_is_directory=True)
        os.mkfifo(self.out / 'pipe.md')
        for path in ['project/papers/link.md', 'project/papers/escape/secret.md', 'project/papers/pipe.md']:
            with self.assertRaises((ValueError, OSError)):
                self.files.open('danus', path)
        fd = self.files.open('danus', 'project/papers/main.tex')
        (self.out / 'main.tex').unlink()
        (self.out / 'main.tex').symlink_to(self.root / 'secret.md')
        with os.fdopen(fd) as opened:
            self.assertEqual(opened.read(), 'math')
        with self.assertRaises(OSError):
            self.files.open('danus', 'project/papers/main.tex')

    def test_bounds_and_ranges(self):
        self.assertEqual(byte_range('bytes=2-4', 10), (2, 4, True))
        self.assertEqual(byte_range('bytes=-3', 10), (7, 9, True))
        self.assertEqual(byte_range(None, 0), (0, -1, False))
        for value in ['bytes=12-', 'bytes=2-1', 'bytes=0-1,3-4', 'bytes=-0']:
            with self.assertRaises(ValueError):
                byte_range(value, 10)
        with self.assertRaises(KeyError):
            self.files.listing('unknown', '')
        with self.assertRaises(ValueError):
            components('/'.join(['project', 'papers'] + ['a'] * 30))

    def test_recursive_filename_search_and_fact_scope(self):
        for folder in ['facts', 'reports', 'report', 'fact_graph/facts', 'notes']:
            target = self.root / 'project' / folder
            target.mkdir(parents=True, exist_ok=True)
            (target / 'theorem.md').write_text('safe output')
        (self.root / 'project/fact_graph/private.md').write_text('private')
        (self.root / 'project/runtime/theorem.md').write_text('private')
        (self.root / 'project/fact_graph/facts/link.md').symlink_to(self.root / 'secret.md')
        (self.root / 'project/fact_graph/facts/escape').symlink_to(self.root, target_is_directory=True)
        result = self.files.search('danus', 'THEOREM')
        self.assertFalse(result['truncated'])
        self.assertEqual({e['path'] for e in result['entries']}, {
            f'project/{folder}/theorem.md' for folder in ['facts', 'reports', 'report', 'fact_graph/facts', 'notes']})
        with os.fdopen(self.files.open('work', 'danus/runtime/projects/project/notes/theorem.md')) as file:
            self.assertEqual(file.read(), 'safe output')
        self.assertIn('danus/runtime/projects/project/notes/theorem.md', {
            e['path'] for e in self.files.search('work', 'theorem')['entries']})
        self.assertEqual([e['name'] for e in self.files.listing('danus', 'project/fact_graph')], ['facts'])
        for path in ['project/fact_graph/private.md', 'project/fact_graph/runtime/a.md', 'project/fact_graph/facts/escape/secret.md']:
            with self.assertRaises((ValueError, OSError)):
                self.files.open('danus', path)
        self.assertEqual(self.files.search('danus', 'private')['entries'], [])
        self.assertEqual(self.files.search('danus', 'link')['entries'], [])
        for query in ['', ' ' * 5, 'a' * 201]:
            with self.assertRaises(ValueError):
                self.files.search('danus', query)
        with patch('server.time.monotonic', side_effect=[0, 4]):
            self.assertTrue(self.files.search('danus', 'theorem')['truncated'])
        with patch.object(self.files, 'listing', return_value=[{'name': 'main.md', 'directory': False}] * 501):
            limited = self.files.search('danus', 'main')
            self.assertEqual(len(limited['entries']), 500)
            self.assertTrue(limited['truncated'])

    def test_work_tree_omits_danus_system_files(self):
        self.assertEqual([e['name'] for e in self.files.listing('work', '')], ['danus'])
        self.assertEqual([e['name'] for e in self.files.listing('work', 'danus')], ['runtime'])
        self.assertEqual([e['name'] for e in self.files.listing('work', 'danus/runtime')], ['projects'])
        self.assertEqual([e['name'] for e in self.files.listing('work', 'danus/runtime/projects')], ['project'])
        path = 'danus/runtime/projects/project/papers/main.tex'
        with os.fdopen(self.files.open('work', path)) as file:
            self.assertEqual(file.read(), 'math')
        self.assertEqual({e['path'] for e in self.files.search('work', 'MAIN')['entries']}, {
            'danus/runtime/projects/project/papers/main.tex', 'danus/runtime/projects/project/papers/main.pdf'})
        for path in ['../secret.md', 'danus/config', 'danus/README.md', 'danus/runtime/codex-home',
                     'danus/runtime/projects/../auth.json', 'danus/runtime/projects/project/runtime',
                     'unknown/runtime/projects', 'danus/runtime/projects/project/fact_graph/private.md']:
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                self.files.listing('work', path)
        self.assertEqual(self.files.search('work', 'private')['entries'], [])

    def test_http_auth_origin_range_and_methods(self):
        server = Server(('127.0.0.1', 0), {'danus': str(self.root)}, 'x' * 64, 'https://example.test')
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        def get(path, headers=None, method='GET'):
            req = Request(base + '/api/project-files/' + path,
                          headers=headers if headers is not None else {'X-Herdr-Gateway': 'x' * 64}, method=method)
            try:
                with urlopen(req, timeout=3) as r:
                    return r.status, r.read(), r.headers
            except HTTPError as e:
                try:
                    return e.code, e.read(), e.headers
                finally:
                    e.close()
        try:
            self.assertEqual(get('roots', {})[0], 403)
            self.assertEqual(get('roots', {'X-Herdr-Gateway':'x'*64, 'Origin':'https://evil.test'})[0], 403)
            self.assertEqual(json.loads(get('roots')[1]), {'roots':['work']})
            (self.root / 'project' / 'PROBLEM.md').write_text('# Research problem\n')
            problem = 'danus/runtime/projects/project/PROBLEM.md'
            self.assertIn('PROBLEM.md', [e['name'] for e in json.loads(get('list?root=work&path=danus/runtime/projects/project')[1])['entries']])
            self.assertEqual(json.loads(get('search?root=work&q=PROBLEM.md')[1])['entries'][0]['path'], problem)
            self.assertEqual(get('content?root=work&path=' + problem + '&download=1')[:2], (200, b'# Research problem\n'))
            self.assertEqual(len(json.loads(get('search?root=work&q=main')[1])['entries']), 2)
            self.assertEqual(get('list?root=work&path=danus/runtime/codex-home')[0], 404)
            self.assertEqual(get('search?root=danus&q=main', {})[0], 403)
            self.assertEqual(get('search?root=danus&q=main', {'X-Herdr-Gateway':'x'*64, 'Origin':'https://evil.test'})[0], 403)
            self.assertEqual(len(json.loads(get('search?root=danus&q=main')[1])['entries']), 2)
            self.assertEqual(get('search?root=unknown&q=main')[0], 404)
            self.assertEqual(get('search?root=danus&q=')[0], 404)
            self.assertEqual(get('search?root=danus&q=main&q=other')[0], 404)
            self.assertEqual(json.loads(get('search?root=danus&q=..%2Fsecret')[1])['entries'], [])
            status, data, headers = get('content?root=danus&path=project/papers/main.pdf', {'X-Herdr-Gateway':'x'*64, 'Range':'bytes=0-3'})
            self.assertEqual((status, data), (206, b'%PDF'))
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            self.assertEqual(get('content?root=danus&path=project/papers/%2e%2e/secret.md')[0], 404)
            self.assertEqual(get('roots', method='POST')[0], 403)
            self.assertEqual(get('roots', method='DELETE')[0], 403)
            self.assertEqual(get('usage?pane=w1:p1', {})[0], 403)
            self.assertEqual(get('usage?pane=w1:p1', {'X-Herdr-Gateway':'x'*64, 'Origin':'https://evil.test'})[0], 403)
            cache = self.root / 'quota.json'
            value = {'status':'ok', 'windows':[], 'account':'test account'}
            cache.write_text(json.dumps({'updatedAt':time.time(),'panes':{'w1:p1':value}}))
            with patch('server.USAGE_CACHE', str(cache)):
                self.assertEqual(json.loads(get('usage?pane=w1:p1')[1]), value)
                self.assertNotIn('account', json.loads(get('usage?pane=w2:p2')[1]))
                self.assertEqual(get('usage?pane=../../secret')[0], 404)
                cache.write_text(json.dumps({'updatedAt':time.time()-151,'panes':{'w1:p1':value}}))
                self.assertEqual(json.loads(get('usage?pane=w1:p1')[1])['windows'], [])
                cache.unlink(); cache.symlink_to(self.root / 'secret.md')
                self.assertEqual(get('usage?pane=w1:p1')[0], 404)
        finally:
            server.shutdown(); server.server_close(); thread.join()

class BookmarkHttpTests(unittest.TestCase):
    def test_authenticated_exact_route_and_no_operation_injection(self):
        import socket
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(str(cache / "reply.sock")); listener.listen(1); listener.settimeout(5)
            received = []
            def reply():
                with listener.accept()[0] as conn:
                    received.append(json.loads(conn.makefile("rb").readline()))
                    conn.sendall(json.dumps({"code": 200, "pins": [], "ids": [], "hasMore": False, "nextOffset": 0}).encode() + b"\n")
            worker = threading.Thread(target=reply, daemon=True); worker.start()
            server = Server(("127.0.0.1", 0), {}, "x" * 64, "https://example.test")
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            base = f"http://127.0.0.1:{server.server_port}/api/project-files/conversation/"
            headers = {"X-Herdr-Gateway": "x" * 64, "Origin": "https://example.test", "X-Herdr-Conversation": "1", "Content-Type": "application/json"}
            body = {"action": "list", "session": "12345678-1234-1234-1234-123456789012", "offset": 0}
            def post(value, changed=None, route="bookmarks"):
                request = Request(base + route, data=json.dumps(value).encode(), headers={**headers, **(changed or {})}, method="POST")
                try:
                    with urlopen(request, timeout=3) as response:return response.status, json.load(response)
                except HTTPError as error:
                    with error:return error.code, json.load(error)
            try:
                with patch("server.CONVERSATION_CACHE", str(cache)):
                    self.assertEqual(post(body, {"Origin": "https://evil.test"})[0], 403)
                    self.assertEqual(post(body, {"X-Herdr-Gateway": "wrong"})[0], 403)
                    self.assertEqual(post(body, {"X-Herdr-Conversation": ""})[0], 403)
                    self.assertEqual(post({**body, "operation": "history"})[0], 400)
                    self.assertEqual(post({**body, "operation": "bookmarks"}, route="reply")[0], 400)
                    self.assertEqual(post(body)[0], 200)
                    self.assertEqual(received, [{**body, "operation": "bookmarks"}])
            finally:
                server.shutdown(); server.server_close(); thread.join(); listener.close(); worker.join(timeout=5)

if __name__ == '__main__':
    unittest.main()
