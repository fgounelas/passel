import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server import Server


class ConversationEndpoint(unittest.TestCase):
    def test_auth_isolation_expiry_and_path_validation(self):
        with tempfile.TemporaryDirectory() as d, patch('server.CONVERSATION_CACHE', d):
            path = Path(d) / (hashlib.sha256(b'w6:p1').hexdigest() + '.json')
            value = {'session': 'example', 'observedAt': time.time(), 'messages': [{'id': '1', 'role': 'assistant', 'text': 'Not yet accepted.'}]}
            path.write_text(json.dumps(value))
            server = Server(('127.0.0.1', 0), {}, 'k' * 40, 'https://example.test')
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def request(query='pane=w6:p1', key='k' * 40, origin='https://example.test'):
                req = Request(f'http://127.0.0.1:{server.server_port}/api/project-files/conversation?{query}',
                    headers={'X-Herdr-Gateway': key, 'Origin': origin})
                try:
                    with urlopen(req) as r:
                        return r.status, json.load(r)
                except HTTPError as e:
                    return e.code, json.load(e)
            try:
                self.assertEqual(request()[1]['messages'][0]['text'], 'Not yet accepted.')
                self.assertEqual(request(key='wrong')[0], 403)
                self.assertEqual(request(origin='https://other.test')[0], 403)
                self.assertEqual(request('pane=w6:p2')[1]['messages'], [])
                for query in ['pane=../secret', 'pane=w6:p1&pane=w6:p2', 'pane=w6:p1&path=/secret']:
                    self.assertEqual(request(query)[0], 404)
                value['observedAt'] = time.time() - 31
                path.write_text(json.dumps(value))
                self.assertEqual(request()[1], {'status': 'stale', 'messages': []})
                path.unlink()
                path.symlink_to(Path(d) / 'secret')
                self.assertEqual(request()[0], 404)
            finally:
                server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()

class ConversationReplies(unittest.TestCase):
    def test_reply_auth_framing_and_proxy(self):
        import socketserver
        seen = []
        class FakeReply(socketserver.StreamRequestHandler):
            def handle(self):
                seen.append(json.loads(self.rfile.readline()))
                self.wfile.write(b'{"code":200,"status":"sent"}\n')
        with tempfile.TemporaryDirectory() as d, patch('server.CONVERSATION_CACHE', d):
            # macOS /var/... temporary names can exceed sockaddr_un's 104-byte limit.
            import os
            socket_path = os.path.realpath(d) + '/reply.sock'
            with socketserver.UnixStreamServer(socket_path, FakeReply) as local:
                worker = threading.Thread(target=local.serve_forever, daemon=True); worker.start()
                server = Server(('127.0.0.1', 0), {}, 'k' * 40, 'https://example.test')
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                def post(key='k' * 40, origin='https://example.test', marker='1', method='POST', body=None, endpoint='reply'):
                    body = body or {'pane': 'w6:p1', 'session': '12345678-1234-1234-1234-123456789012', 'text': 'one\ntwo'}
                    req = Request(f'http://127.0.0.1:{server.server_port}/api/project-files/conversation/{endpoint}', method=method,
                        data=json.dumps(body).encode(), headers={'X-Herdr-Gateway': key, 'Origin': origin,
                        'X-Herdr-Conversation': marker, 'Content-Type': 'application/json'})
                    try:
                        with urlopen(req) as r:return r.status
                    except HTTPError as e:
                        with e:return e.code
                try:
                    self.assertEqual(post(key='wrong'), 403)
                    self.assertEqual(post(origin='https://foreign.test'), 403)
                    self.assertEqual(post(marker=''), 403)
                    self.assertEqual(post(method='DELETE'), 405)
                    self.assertEqual(seen, [])
                    self.assertEqual(post(), 200)
                    self.assertEqual(seen, [{'pane': 'w6:p1', 'session': '12345678-1234-1234-1234-123456789012', 'text': 'one\ntwo'}])
                    archive = {'action': 'quit', 'tab': 'w1:t1'}
                    self.assertEqual(post(endpoint='archives', body=archive, key='wrong'), 403)
                    self.assertEqual(post(endpoint='archives', body=archive, origin='https://foreign.test'), 403)
                    self.assertEqual(post(endpoint='archives', body=archive, marker=''), 403)
                    self.assertEqual(post(endpoint='archives', body=archive, method='DELETE'), 405)
                    self.assertEqual(post(endpoint='archives', body={**archive, 'operation': 'reply'}), 400)
                    self.assertEqual(len(seen), 1)
                    self.assertEqual(post(endpoint='archives', body=archive), 200)
                    self.assertEqual(seen[-1], {'operation': 'archives', **archive})
                    choice = {'action': 'inspect', 'pane': 'w1:p1'}
                    self.assertEqual(post(endpoint='choice', body=choice, key='wrong'), 403)
                    self.assertEqual(post(endpoint='choice', body=choice, origin='https://foreign.test'), 403)
                    self.assertEqual(post(endpoint='choice', body=choice, marker=''), 403)
                    self.assertEqual(post(endpoint='choice', body={**choice, 'operation': 'reply'}), 400)
                    self.assertEqual(post(endpoint='choice', body=choice), 200)
                    self.assertEqual(seen[-1], {'operation': 'choice', **choice})
                    reset = {'pane': 'w3:pZ', 'accountKey': 'a' * 64, 'requestId': '935b1e46-f4fa-4361-a8d9-f8a91cfefc9e', 'creditId': 'credit', 'availableCount': 1}
                    # Usage controls retain exact-origin/gateway/marker protection.
                    def usage_post(changed=None):
                        req = Request(f'http://127.0.0.1:{server.server_port}/api/project-files/usage/reset', data=json.dumps(reset).encode(),
                            headers={'X-Herdr-Gateway': 'k' * 40, 'Origin': 'https://example.test', 'X-Herdr-Conversation': '1', 'Content-Type': 'application/json', **(changed or {})})
                        try:
                            with urlopen(req) as response:return response.status
                        except HTTPError as error:
                            with error:return error.code
                    self.assertEqual(usage_post({'Origin': 'https://foreign.test'}), 403)
                    self.assertEqual(usage_post({'X-Herdr-Gateway': 'wrong'}), 403)
                    self.assertEqual(usage_post({'X-Herdr-Conversation': ''}), 403)
                    self.assertEqual(usage_post(), 200)
                    self.assertEqual(seen[-1], {'operation': 'usage_reset', **reset})
                finally:
                    server.shutdown(); server.server_close(); thread.join()
                    local.shutdown(); worker.join()
