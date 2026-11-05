import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from bookmarks import Bookmarks, bookmark_request
from replies import ReplyError

SESSION = '12345678-1234-1234-1234-123456789012'
OTHER = '12345678-1234-1234-1234-123456789013'

class BookmarkTests(unittest.TestCase):
    def test_persist_across_service_restart_without_live_session(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'rollout.jsonl'
            path.write_text(json.dumps({'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant',
                'content': [{'type': 'output_text', 'text': 'Verified mathematics.'}]}}) + '\n')
            store = Bookmarks(Path(folder) / 'state/bookmarks.sqlite')
            body = {'operation': 'bookmarks', 'action': 'add', 'pane': 'w3:p1', 'session': SESSION, 'message': '0'}
            discover = lambda: {'w3:p1': (path, SESSION)}
            bookmark_request(body, discover, store)
            bookmark_request(body, discover, store)  # retry is idempotent
            path.unlink()
            restarted = Bookmarks(store.path)
            saved = bookmark_request({'operation': 'bookmarks', 'action': 'list', 'session': SESSION, 'offset': 0}, lambda: {}, restarted)
            self.assertEqual([p['text'] for p in saved['pins']], ['Verified mathematics.'])
            self.assertEqual(restarted.list(OTHER)['pins'], [])
            bookmark_request({'operation': 'bookmarks', 'action': 'remove', 'session': SESSION, 'message': '0'}, lambda: {}, restarted)
            self.assertEqual(restarted.list(SESSION)['pins'], [])

    def test_reject_wrong_session_paths_text_and_tool_records(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Bookmarks(Path(folder) / 'bookmarks.sqlite')
            path = Path(folder) / 'rollout.jsonl'
            path.write_text(json.dumps({'type': 'response_item', 'payload': {'type': 'function_call_output', 'output': 'tool'}}) + '\n')
            body = {'operation': 'bookmarks', 'action': 'add', 'pane': 'pane', 'session': SESSION, 'message': '0'}
            for change, mapping in [({}, {}), ({'path': str(path)}, {'pane': (path, SESSION)}),
                    ({'text': 'forged'}, {'pane': (path, SESSION)}), ({'message': '../bad'}, {}),
                    ({}, {'pane': (path, OTHER)}), ({}, {'pane': (path, SESSION)}),
                    ({'message': '1'}, {'pane': (path, SESSION)})]:
                with self.assertRaises(ReplyError): bookmark_request({**body, **change}, lambda: mapping, store)

    def test_storage_cap_and_bounded_pages(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Bookmarks(Path(folder) / 'bookmarks.sqlite')
            for i in range(10):store.add(SESSION, {'id': str(i), 'role': 'user', 'text': 'x' * 64_000})
            first = store.list(SESSION)
            self.assertEqual(len(first['pins']), 7)
            self.assertTrue(first['hasMore'])
            self.assertEqual(len(store.list(SESSION, first['nextOffset'])['pins']), 3)
            with patch('bookmarks.MAX_PINS', 10), self.assertRaises(ReplyError):
                store.add(OTHER, {'id': '1', 'role': 'user', 'text': 'more'})
            self.assertEqual(len(store.list(SESSION)['ids']), 10)

if __name__ == '__main__':unittest.main()
