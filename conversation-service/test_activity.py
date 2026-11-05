import json
from pathlib import Path
import tempfile
import unittest
from activity import Activity
from collector import Reader


def record(kind, **fields):
    return {'type': 'response_item', 'payload': {'type': kind, **fields}}


def lifecycle(kind):
    return {'type': 'event_msg', 'payload': {'type': kind}}


class ActivityTests(unittest.TestCase):
    def test_latest_command_and_matching_output_only(self):
        activity = Activity()
        activity.update(lifecycle('task_started'))
        activity.update(record('function_call', name='exec_command', call_id='1', arguments=json.dumps({'cmd': 'ls plans'})))
        self.assertIn('ls plans', activity.current['command'])
        activity.update(record('function_call_output', call_id='1', output='audit.md'))
        self.assertEqual(activity.current['output'], 'audit.md')
        activity.update(record('custom_tool_call', name='exec', call_id='2', input='text(await tools.exec_command({cmd: "pwd"}));'))
        self.assertEqual(activity.current['output'], '')
        activity.update(record('function_call_output', call_id='1', output='late old output'))
        self.assertEqual(activity.current['output'], '')
        activity.update(record('custom_tool_call_output', call_id='2', output=[{'type': 'input_text', 'text': '/work'}, {'type': 'image', 'data': 'PRIVATE_IMAGE'}]))
        self.assertEqual(activity.current['output'], '/work')
        activity.update(record('function_call', name='wait', call_id='3', arguments='{}'))
        self.assertEqual(activity.current['id'], '2')

    def test_native_command_completion_and_turn_boundaries(self):
        activity = Activity()
        activity.update(lifecycle('task_started'))
        event = {'type': 'event_msg', 'payload': {'type': 'item_completed', 'item': {
            'type': 'CommandExecution', 'id': 'native', 'command': ['sh', '-c', 'pwd'],
            'parsed_cmd': [{'cmd': 'pwd', 'type': 'unknown'}], 'aggregated_output': '/work'}}}
        activity.update(event)
        self.assertEqual(activity.current, {'id': 'native', 'command': 'pwd', 'output': '/work'})
        for completion in ('task_complete', 'turn_aborted'):
            activity.update(lifecycle(completion))
            self.assertIsNone(activity.current)
            self.assertFalse(activity.turn_active)
            activity.update(event)
            self.assertIsNone(activity.current)
            activity.update(lifecycle('task_started'))
            self.assertTrue(activity.turn_active)
            self.assertIsNone(activity.current)
            activity.update(event)

    def test_bounds_plain_text_and_reasoning_exclusion(self):
        activity = Activity()
        activity.update(record('function_call', name='exec_command', call_id='1', arguments=json.dumps({'cmd': 'x' * 10000})))
        activity.update(record('function_call_output', call_id='1', output='\x1b[31m<script>plain</script>\x00' + 'x' * 10000))
        self.assertLessEqual(len(activity.current['command']), 2001)
        self.assertLessEqual(len(activity.current['output']), 4001)
        self.assertNotIn('\x1b', activity.current['output'])
        self.assertNotIn('\x00', activity.current['output'])
        saved = dict(activity.current)
        activity.update(record('reasoning', text='PRIVATE'))
        self.assertEqual(activity.current, saved)

    def test_reader_never_adds_tools_to_history_and_resets_on_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'rollout.jsonl'
            path.write_text(json.dumps(record('function_call', name='exec_command', call_id='1', arguments='{"cmd":"pwd"}')) + '\n')
            reader = Reader(path)
            self.assertEqual(reader.update(), [])
            self.assertIn('pwd', reader.activity.current['command'])
            with path.open('a') as f:
                f.write(json.dumps(lifecycle('task_complete')) + '\n')
            reader.update()
            self.assertIsNone(reader.activity.current)
            other = Path(folder) / 'replacement'
            other.write_text(json.dumps(lifecycle('task_started')) + '\n')
            other.replace(path)
            reader.update()
            self.assertIsNone(reader.activity.current)
            self.assertTrue(reader.activity.turn_active)
