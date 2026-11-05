import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from collector import (Reader, display_message, main_session, process_session,
                       foreground_terminal_start, resumed_codex_thread, initial_codex_client, foreground_codex_client)


def event(text, role='assistant', **extra):
    return {'type': 'response_item', 'payload': {'type': 'message', 'role': role,
        'content': [{'type': 'output_text' if role == 'assistant' else 'input_text', 'text': text}], **extra}}


class Conversations(unittest.TestCase):
    def test_shared_daemon_startup_requires_blank_live_tui_and_exact_foreground_pid(self):
        info = {'agent': 'codex', 'agent_status': 'idle', 'foreground_cwd': '/work/danus', 'terminal_title_stripped': 'danus'}
        screen = '>_ OpenAI Codex (v0.162.0)\n\n» Ask Codex to do anything\nGPT-6.1-Sol'
        def api(method, params):
            if method == 'pane.process_info':
                return {'process_info': {'pane_id': 'w3:pZ', 'foreground_processes': [{'pid': 123, 'name': 'codex'}]}}
            self.assertEqual(method, 'pane.read')
            self.assertEqual(params['source'], 'detection')
            return {'read': {'text': screen}}
        self.assertTrue(initial_codex_client('w3:pZ', '123', info, [b'codex', b'-c', b'check_for_update_on_startup=false'], api))
        self.assertFalse(initial_codex_client('w3:pZ', '456', info, [b'codex'], api))
        for change in ({'agent_status': 'blocked'}, {'agent_session': {'kind': 'id', 'value': 'old'}},
                       {'terminal_title_stripped': 'Existing project | danus'}, {'foreground_cwd': '/work/other'}):
            self.assertFalse(initial_codex_client('w3:pZ', '123', {**info, **change}, [b'codex'], api))
        for args in ([b'codex', b'resume', b'--last'], [b'codex', b'fork'], [b'codex', b'exec', b'query']):
            self.assertFalse(initial_codex_client('w3:pZ', '123', info, args, api))
        for screen in ('» Ask Codex to do anything', '>_ OpenAI Codex (v0.162.0)\n» Already typed text',
                       '>_ OpenAI Codex (v0.162.0)\nDo you trust this folder?'):
            self.assertFalse(initial_codex_client('w3:pZ', '123', info, [b'codex'], api))

    def test_writer_mapping_checks_exact_codex_process_in_the_target_pane(self):
        api = Mock(return_value={'process_info': {'pane_id': 'w3:pZ', 'foreground_processes': [{'pid': 123, 'name': 'codex'}]}})
        self.assertTrue(foreground_codex_client('w3:pZ', '123', api))
        self.assertFalse(foreground_codex_client('w3:pZ', '124', api))
        self.assertFalse(foreground_codex_client('w3:pOther', '123', api))

    def test_keeps_progress_and_caveats_but_never_tools(self):
        text = 'The sample configuration is now under verification. It is not yet an accepted result.'
        self.assertEqual(display_message(event(text, phase='commentary'), 12)['text'], text)
        self.assertEqual(display_message(event('12 accepted facts; cleanup remains.', phase='final'), 13)['role'], 'assistant')
        for kind in ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'reasoning', 'agent_message']:
            self.assertIsNone(display_message({'type': 'response_item', 'payload': {'type': kind, 'text': 'PRIVATE TOOL OUTPUT'}}, 0))
        self.assertIsNone(display_message({'type': 'event_msg', 'payload': {'type': 'agent_message', 'message': text}}, 0))
        self.assertIsNone(display_message(event('private reasoning', channel='analysis'), 0))

    def test_codex_final_answer_phase_is_preserved_in_full(self):
        conclusion = ('The example bound is sharp. Equality holds in the first case.\n\n'
                      '| Surface | Big? | Nef? |\n| --- | --- | --- |\n| Example | No | No |\n\n'
                      r'Write $X=\mathbf P(\Omega^1_S)$ and $L=\mathcal O_X(1)$.')
        message = display_message(event(conclusion, phase='final_answer'), 37)
        self.assertIsNotNone(message)
        self.assertEqual(message['text'], conclusion)
        self.assertEqual(message['role'], 'assistant')
        self.assertFalse(message['truncated'])
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            path.write_text(json.dumps(event('I will separate the consequences.', phase='commentary')) + '\n' +
                            json.dumps(event(conclusion, phase='final_answer')) + '\n')
            self.assertEqual([m['text'] for m in Reader(path).update()],
                             ['I will separate the consequences.', conclusion])

    def test_human_input_and_injected_context(self):
        self.assertEqual(display_message(event('Explain this formula', 'user'), 0)['role'], 'user')
        self.assertIsNone(display_message(event('# AGENTS.md instructions for /home/example', 'user'), 0))
        self.assertIsNone(display_message(event('<environment_context>private</environment_context>', 'user'), 0))
        self.assertIsNone(display_message(event('system text', 'developer'), 0))
        self.assertIsNone(display_message(event('<codex_internal_context source="goal">Continue working toward the active thread goal.</codex_internal_context>', 'user'), 0))
        self.assertEqual(display_message(event('The example task has finished; cleanup remains.'), 0)['role'], 'assistant')

    def test_partial_records_append_and_replacement(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            line = (json.dumps(event('first')) + '\n').encode()
            path.write_bytes(line + b'{"type":')
            reader = Reader(path)
            self.assertEqual([m['text'] for m in reader.update()], ['first'])
            self.assertEqual([m['text'] for m in reader.update()], ['first'])
            path.write_bytes(line + (json.dumps(event('second')) + '\n').encode())
            self.assertEqual([m['text'] for m in reader.update()], ['first', 'second'])
            other = Path(d) / 'new'
            other.write_text(json.dumps(event('replacement')) + '\n')
            other.replace(path)
            self.assertEqual([m['text'] for m in reader.update()], ['replacement'])

    def test_mapping_excludes_helpers_symlinks_outside_and_ambiguity(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            paths = []
            for name, source in [('main', 'cli'), ('helper', {'subagent': {}}), ('worker', 'exec')]:
                p = root / (name + '.jsonl')
                p.write_text(json.dumps({'payload': {'source': source, 'id': name}}) + '\n')
                paths.append(str(p))
            self.assertEqual(main_session(paths, [root]), (paths[0], 'main'))
            self.assertIsNone(main_session(paths, [root / 'other']))
            alias = root / 'alias.jsonl'
            alias.symlink_to(paths[0])
            self.assertIsNone(main_session([str(alias)], [root]))
            another = root / 'second.jsonl'
            another.write_text(json.dumps({'payload': {'source': 'cli', 'id': 'second'}}))
            self.assertIsNone(main_session(paths + [str(another)], [root]))

    def test_new_process_before_first_message(self):
        path, token = process_session('w3:pV', '123', '456', ['/dev/pts/1', 'socket:[42]'])
        self.assertIsNone(path)
        self.assertEqual(len(token), 36)
        self.assertEqual(process_session('w3:pV', '123', '456', [])[1], token)
        self.assertNotEqual(process_session('w3:pV', '123', '457', [])[1], token)
        self.assertNotEqual(process_session('w3:pW', '123', '456', [])[1], token)
        self.assertIsNone(process_session('w3:pV', '123', '456', ['/foreign/sessions/test.jsonl']))

    def test_explicit_resume_after_global_options(self):
        thread = b'00000000-0000-0000-0000-000000000064'
        for options in ([], [b'-c', b'check_for_update_on_startup=false'],
                        [b'--config=notice=resume', b'--no-alt-screen'],
                        [b'-p', b'resume', b'-C', b'/work']):
            self.assertEqual(resumed_codex_thread([b'codex', *options, b'resume', thread, b'']), thread.decode())
        for argv in ([b'codex', b'-c', b'resume', thread],
                     [b'codex', b'exec', b'resume', thread],
                     [b'codex', b'--unknown', b'resume', thread],
                     [b'codex', b'resume', b'--last'], [b'codex', b'-c']):
            self.assertIsNone(resumed_codex_thread(argv))

    def test_resume_disambiguates_open_rollouts_without_guessing(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            main = root / 'main.jsonl'
            other = root / 'other.jsonl'
            main.write_text(json.dumps({'payload': {'source': 'cli', 'id': 'main'}}))
            other.write_text(json.dumps({'payload': {'source': 'cli', 'id': 'other'}}))
            paths = [str(main), str(other)]
            self.assertIsNone(main_session(paths, [root]))
            self.assertEqual(main_session(paths, [root], 'main'), (str(main), 'main'))
            self.assertIsNone(main_session(paths, [root], 'missing'))
            self.assertIsNone(main_session(paths, [root / 'elsewhere'], 'main'))
            main.write_text(json.dumps({'payload': {'source': 'vscode', 'id': 'main'}}))
            self.assertIsNone(main_session([str(main)], [root]))
            self.assertEqual(main_session(paths, [root], 'main'), (str(main), 'main'))
            main.write_text(json.dumps({'payload': {'source': 'exec', 'id': 'main'}}))
            self.assertIsNone(main_session(paths, [root], 'main'))
            main.write_text(json.dumps({'payload': {'source': 'vscode', 'id': 'main'}}))
            alias = root / 'alias.jsonl'
            alias.symlink_to(main)
            self.assertIsNone(main_session([str(alias)], [root], 'main'))
            other.write_text(main.read_text())
            self.assertIsNone(main_session(paths, [root], 'main'))

    def test_foreground_terminal_excludes_inherited_pane_helpers(self):
        def proc_stat(pgrp, tty, foreground):
            fields = ['S', '100', str(pgrp), '100', str(tty), str(foreground)] + ['0'] * 13 + ['456']
            return '123 (codex (helper)) ' + ' '.join(fields)
        self.assertEqual(foreground_terminal_start(proc_stat(123, 34841, 123)), '456')
        self.assertIsNone(foreground_terminal_start(proc_stat(124, 0, -1)))
        self.assertIsNone(foreground_terminal_start(proc_stat(125, 0, 125)))
        self.assertIsNone(foreground_terminal_start(proc_stat(126, 34841, 123)))
        self.assertIsNone(foreground_terminal_start('123 (codex) S 100'))

    def test_bounded_history(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'rollout.jsonl'
            path.write_text(''.join(json.dumps(event(str(i))) + '\n' for i in range(350)))
            reader = Reader(path)
            messages = reader.update()
            self.assertEqual(len(messages), 300)
            self.assertEqual(messages[-1]['text'], '349')
            self.assertTrue(reader.earlier)


if __name__ == '__main__':
    unittest.main()
