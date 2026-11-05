import json
from pathlib import Path
import tempfile
import unittest
from collector import display_message
from history import history_request, read_history
from replies import ReplyError
from unittest.mock import patch


def event(text, role='assistant'):
    return {'type': 'response_item', 'payload': {'type': 'message', 'role': role, 'content': [{'type': 'output_text', 'text': text}]}}


class History(unittest.TestCase):
    def test_previous_prompt_skips_dense_assistant_output_and_returns_reading_context(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'rollout.jsonl'
            records = [event('First prompt', 'user'), event('First answer'), event('Second prompt', 'user')]
            records += [event('Dense assistant update '+str(i)) for i in range(500)]
            path.write_text(''.join(json.dumps(record)+'\n' for record in records))
            page = read_history(path, 'prompt', path.stat().st_size)
            self.assertEqual(page['messages'][0]['text'], 'Second prompt')
            self.assertLessEqual(len(page['messages']), 40)
            earlier = read_history(path, 'prompt', page['before'])
            self.assertEqual(earlier['messages'][0]['text'], 'First prompt')
            self.assertEqual(read_history(path, 'prompt', 0)['messages'], [])

    def test_prompt_scan_advances_by_the_byte_budget_through_no_prompt_gaps(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'rollout.jsonl'
            path.write_text(json.dumps(event('Only prompt', 'user'))+'\n'+
                            ''.join(json.dumps(event('Assistant update '+str(i)))+'\n' for i in range(200)))
            cursor = path.stat().st_size
            with patch('history.TAIL', 4096):
                for _ in range(20):
                    page = read_history(path, 'prompt', cursor)
                    if page['messages']:
                        self.assertEqual(page['messages'][0]['text'], 'Only prompt')
                        break
                    self.assertGreater(cursor-page['before'], 3500)
                    self.assertTrue(page['hasEarlier'])
                    cursor = page['before']
                else:
                    self.fail('Prompt scan did not make bounded backwards progress')

    def test_beginning_and_both_directions_without_tools_or_duplicates(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            records = [event('<codex_internal_context source="goal">hidden', 'user')]
            for i in range(105):
                records += [event(str(i)), {'type': 'response_item', 'payload': {'type': 'function_call_output', 'output': 'hidden tool'}}]
            path.write_text(''.join(json.dumps(e) + '\n' for e in records))
            start = read_history(path, 'start', 0)
            self.assertEqual([m['text'] for m in start['messages']], list(map(str, range(40))))
            self.assertFalse(start['hasEarlier']); self.assertTrue(start['hasLater'])
            next_page = read_history(path, 'after', start['after'])
            self.assertEqual([m['text'] for m in next_page['messages']], list(map(str, range(40,80))))
            back = read_history(path, 'before', next_page['before'])
            self.assertEqual(back['messages'], start['messages'])
            last = read_history(path, 'after', next_page['after'])
            self.assertEqual([m['text'] for m in last['messages']], list(map(str, range(80,105))))
            self.assertFalse(last['hasLater'])
            with self.assertRaises(ReplyError):read_history(path, 'before', -1)
            with self.assertRaises(ReplyError):read_history(path, 'before', path.stat().st_size + 1)

    def test_search_only_visible_messages_case_insensitive_and_pages(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            records = [event('<codex_internal_context>needle', 'user'),
                       {'type': 'response_item', 'payload': {'type': 'function_call_output', 'output': 'needle'}}]
            records += [event(f'Needle {i}') for i in range(45)]
            path.write_text(''.join(json.dumps(e) + '\n' for e in records))
            first = read_history(path, 'search', 0, 'needle')
            self.assertEqual(len(first['messages']), 40)
            self.assertEqual(first['messages'][0]['text'], 'Needle 0')
            second = read_history(path, 'search', first['nextCursor'], 'needle')
            self.assertEqual(len(second['messages']), 5)
            self.assertFalse(second['hasLater'])
            self.assertEqual(read_history(path, 'search', 0, 'absent')['messages'], [])

    def test_final_answers_survive_history_and_search(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            final = event('The example bound is sharp.')
            final['payload']['phase'] = 'final_answer'
            path.write_text(json.dumps(final) + '\n')
            self.assertEqual(read_history(path, 'start', 0)['messages'][0]['text'],
                             'The example bound is sharp.')
            self.assertEqual(len(read_history(path, 'search', 0, 'bound is sharp')['messages']), 1)

    def test_unmatched_sessions_never_read_files(self):
        body = {'operation': 'history', 'pane': 'w1:p1', 'session': 'id', 'direction': 'start', 'cursor': 0}
        for mapping in [{}, {'w1:p1': ('/secret', 'different')}, {'w1:p1': (None, 'id')}]:
            with self.assertRaises(ReplyError):history_request(body, lambda: mapping)
