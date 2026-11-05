import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server import Files, Server, MAX_UPLOAD, UPLOAD_RESERVE, UploadError, save_upload, UPLOAD_EXTENSIONS


EXTRA_UPLOADS = {
    'refs.bib': b'@article{example, title={Example}}',
    'proof.lean': b'theorem example : 1 = 1 := rfl',
    'data.csv': b'x,y\n1,2\n',
    'data.json': b'{"value": 1}',
    'script.py': b'print(1)',
    'calculation.sage': b'factor(12)',
    'notebook.ipynb': b'{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}',
    'macros.sty': b'\\ProvidesPackage{macros}',
    'paper.cls': b'\\ProvidesClass{paper}',
    'figure.png': b'\x89PNG\r\n\x1a\nheader-only-format-check',
    'figure.jpg': b'\xff\xd8\xff\xe0header-only-format-check\xff\xd9',
    'figure.jpeg': b'\xff\xd8\xff\xe0header-only-format-check\xff\xd9',
}


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)

    def tearDown(self):
        os.close(self.fd)
        self.temp.cleanup()

    def save(self, name, content):
        return save_upload(self.fd, name, len(content), io.BytesIO(content))

    def test_types_and_collision_preserve_existing_files(self):
        for name, content in [('paper.pdf', b'%PDF-1.7\nexample'), ('a.tex', 'x ∈ X'.encode()),
                              ('a.txt', b'notes'), ('a.MD', '# Notes\n\n$x ∈ X$'.encode()), ('scan.djvu', b'AT&TFORM\x00\x00\x00\x04DJVU')]:
            self.assertEqual(self.save(name, content), name)
            self.assertEqual((self.path/name).read_bytes(), content)
        for name, content in EXTRA_UPLOADS.items():
            self.assertEqual(self.save(name, content), name)
            self.assertEqual((self.path/name).read_bytes(), content)
        (self.path/'a-1.txt').symlink_to('/nonexistent')
        self.assertEqual(self.save('a.txt', b'new'), 'a-2.txt')
        self.assertEqual((self.path/'a.txt').read_bytes(), b'notes')
        self.assertTrue((self.path/'a-1.txt').is_symlink())
        self.assertEqual((self.path/'a-2.txt').stat().st_mode & 0o777, 0o600)

    def test_reject_paths_types_and_disguised_binary_without_partial_files(self):
        for name, content in [('../x.pdf', b'%PDF-x'), ('/x.pdf', b'%PDF-x'), ('x\\y.tex', b'x'),
                              ('.secret.txt', b'x'), ('x\n.txt', b'x'), ('x.html', b'x'), ('x.pdf.exe', b'x'),
                              ('fake.png', b'not png'), ('fake.jpg', b'not jpeg'), ('fake.jpeg', b'not jpeg'), ('fake.pdf', b'not pdf'), ('fake.djvu', b'not djvu'), ('x.tex', b'\x00binary'),
                              ('x.md', b'\xff'), ('x.md', b'\x00binary'), ('x.md.exe', b'x'), ('x.txt', b'\xff'), ('x.txt', b'')]:
            with self.subTest(name=name), self.assertRaises(UploadError):
                self.save(name, content)
            self.assertEqual(list(self.path.iterdir()), [])
        with self.assertRaises(UploadError):
            save_upload(self.fd, 'x.txt', 30, io.BytesIO(b'short'))
        self.assertEqual(list(self.path.iterdir()), [])

    def test_extra_text_formats_reject_binary_and_invalid_utf8(self):
        for name in EXTRA_UPLOADS:
            if Path(name).suffix in ('.png', '.jpg', '.jpeg'):
                continue
            for content in (b'\xff', b'\x00binary'):
                with self.subTest(name=name, content=content), self.assertRaises(UploadError):
                    self.save(name, content)
                self.assertEqual(list(self.path.iterdir()), [])

    def test_size_and_free_space_checks_before_and_during_transfer(self):
        with self.assertRaises(UploadError) as error:
            save_upload(self.fd, 'x.txt', MAX_UPLOAD+1, io.BytesIO())
        self.assertEqual(error.exception.status, 413)
        with patch('server.upload_free', return_value=UPLOAD_RESERVE+2):
            with self.assertRaises(UploadError) as error:
                self.save('x.txt', b'abc')
        self.assertEqual(error.exception.status, 507)
        with patch('server.upload_free', side_effect=[UPLOAD_RESERVE+100, UPLOAD_RESERVE-1]):
            with self.assertRaises(UploadError):
                self.save('x.txt', b'abc')
        self.assertEqual(list(self.path.iterdir()), [])

    def test_bounded_stream_reads_and_unicode_chunk_boundary(self):
        content = ('a'*65535 + 'é' + 'z'*65536).encode()
        class Stream(io.BytesIO):
            def read(self, size=-1):
                self_test.assertLessEqual(size, 65536)
                self_test.assertGreater(size, 0)
                return super().read(size)
        self_test = self
        save_upload(self.fd, 'unicode.txt', len(content), Stream(content))
        self.assertEqual((self.path/'unicode.txt').read_bytes(), content)

    def test_http_upload_auth_origin_size_search_and_download(self):
        projects=self.path/'projects';projects.mkdir()
        server=Server(('127.0.0.1',0), {'danus':str(projects)}, 'x'*64, 'https://example.test', self.path)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_port}/api/project-files/'
        headers={'X-Herdr-Gateway':'x'*64,'Origin':'https://example.test','X-Herdr-Upload':'1','Content-Type':'application/octet-stream'}
        def request(path, data=None, override=None, method=None):
            h=headers.copy();h.update(override or {})
            try:
                with urlopen(Request(base+path,data=data,headers=h,method=method),timeout=3) as r:
                    return r.status,r.read()
            except HTTPError as e:
                with e:return e.code,e.read()
        try:
            for override in [{'X-Herdr-Gateway':''},{'Origin':''},{'Origin':'https://evil.test'},{'X-Herdr-Upload':''}]:
                self.assertEqual(request('upload?name=a.txt',b'hello',override)[0],403)
            self.assertEqual(request('upload?name=a.txt',b'hello',{'Content-Length':str(MAX_UPLOAD+1)})[0],413)
            self.assertEqual(request('upload?name=a.txt&path=elsewhere',b'hello')[0],400)
            self.assertEqual(request('upload?name=..%2Fx.txt',b'hello')[0],400)
            self.assertEqual(request('upload?name=x.txt',b'hello',{'Content-Type':'text/plain'})[0],415)
            server.upload_slots.acquire()
            try:self.assertEqual(request('upload?name=a.txt',b'hello')[0],429)
            finally:server.upload_slots.release()
            status,body=request('upload?name=a.txt',b'hello')
            self.assertEqual(status,201)
            self.assertEqual(json.loads(body)['path'],'uploads/a.txt')
            markdown = '# Uploaded notes\n\n$x ∈ X$\n'.encode()
            status,body=request('upload?name=notes.md',markdown)
            self.assertEqual(status,201)
            self.assertEqual(json.loads(body)['path'],'uploads/notes.md')
            self.assertIn('.md',json.loads(request('upload-info')[1])['extensions'])
            self.assertEqual(request('content?root=work&path=uploads/notes.md'),(200,markdown))
            self.assertEqual(request('content?root=work&path=uploads/notes.md&download=1'),(200,markdown))
            self.assertEqual(json.loads(request('search?root=work&q=notes.md')[1])['entries'][0]['path'],'uploads/notes.md')
            self.assertEqual(request('upload?name=notes.md',method='DELETE')[0],200)
            self.assertFalse((self.path/'notes.md').exists())
            self.assertEqual(set(json.loads(request('upload-info')[1])['extensions']), UPLOAD_EXTENSIONS)
            for name, content in EXTRA_UPLOADS.items():
                with self.subTest(name=name):
                    self.assertEqual(request('upload?name='+name,content)[0],201)
                    self.assertIn(name,[e['name'] for e in json.loads(request('list?root=work&path=uploads')[1])['entries']])
                    self.assertEqual(request('content?root=work&path=uploads/'+name),(200,content))
                    self.assertEqual(request('content?root=work&path=uploads/'+name+'&download=1'),(200,content))
                    with urlopen(Request(base+'content?root=work&path=uploads/'+name,headers=headers),timeout=3) as response:
                        expected_type = 'image/png' if name.endswith('.png') else 'image/jpeg' if name.endswith(('.jpg', '.jpeg')) else 'text/plain; charset=utf-8'
                        self.assertEqual(response.headers['Content-Type'],expected_type)
                        if name.endswith(('.png', '.jpg', '.jpeg')):
                            self.assertTrue(response.headers['Content-Disposition'].startswith('attachment;'))
                    self.assertEqual(json.loads(request('search?root=work&q='+name)[1])['entries'][0]['path'],'uploads/'+name)
                    self.assertEqual(request('upload?name='+name,method='DELETE')[0],200)
                    self.assertFalse((self.path/name).exists())
            self.assertEqual([e['name'] for e in json.loads(request('list?root=work&path=')[1])['entries']], ['danus', 'uploads'])
            self.assertEqual([e['name'] for e in json.loads(request('list?root=work&path=danus')[1])['entries']], ['runtime'])
            self.assertEqual(request('list?root=work&path=danus/uploads')[0],404)
            status,body=request('search?root=work&q=a.txt')
            self.assertEqual(json.loads(body)['entries'][0]['path'],'uploads/a.txt')
            self.assertEqual(request('content?root=work&path=uploads/a.txt&download=1'),(200,b'hello'))
            for path in ['uploads/../secret.txt','uploads/nested/file.txt']:
                self.assertEqual(request('content?root=work&path='+path)[0],404)
            (self.path/'link.txt').symlink_to('/etc/passwd')
            self.assertEqual(request('content?root=work&path=uploads/link.txt')[0],404)
            self.assertEqual(json.loads(request('list?root=work&path=uploads')[1])['entries'][0]['name'],'a.txt')
            outside = projects/'protected.txt'; outside.write_text('keep')
            for override in [{'X-Herdr-Gateway':''},{'Origin':''},{'Origin':'https://evil.test'},{'X-Herdr-Upload':''}]:
                self.assertEqual(request('upload?name=a.txt',override=override,method='DELETE')[0],403)
            for name in ['../projects/protected.txt','/etc/passwd','link.txt','projects']:
                self.assertEqual(request('upload?name='+name,method='DELETE')[0],400)
            self.assertEqual(request('content?root=work&path=uploads/a.txt',method='DELETE')[0],404)
            self.assertEqual(request('upload?name=a.txt&root=danus',method='DELETE')[0],400)
            self.assertEqual(request('upload?name=a.txt',method='DELETE')[0],200)
            self.assertFalse((self.path/'a.txt').exists())
            self.assertEqual(outside.read_text(),'keep')
            self.assertTrue((self.path/'link.txt').is_symlink())

        finally:
            server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
