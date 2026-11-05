import json
from pathlib import Path
import tempfile
import unittest
from claude import match_session
from collector import display_message, Reader
from history import read_history
from activity import Activity
from replies import send_reply, ReplyError
from unittest.mock import Mock

SESSION = '75f008f9-ee36-48f2-9b1c-3d37c1209de4'


def event(role, content, **extra):
    return {'type': role, 'message': {'role': role, 'content': content},
            'sessionId': SESSION, 'cwd': '/work/math', 'isSidechain': False, **extra}


class Claude(unittest.TestCase):
    def test_delivered_mid_turn_prompts_are_user_messages_but_queues_and_worker_reports_are_not(self):
        accepted = {'type': 'queue-operation', 'operation': 'remove', 'reason': 'absorbed_mid_turn',
                    'sessionId': SESSION, 'commandUuid': '775f0618-2ec6-49dd-8d51-807a74c3c7c7',
                    'deliveryId': 'd4240451-5037-430c-8ebb-1a5d694d579f',
                    'timestamp': '2026-10-20T22:10:28Z', 'content': 'Run a full mathematical audit.'}
        self.assertEqual(display_message(accepted, 42), {'id': '42', 'role': 'user',
            'text': accepted['content'], 'truncated': False, 'timestamp': accepted['timestamp']})
        for patch in [{'operation': 'enqueue'}, {'operation': 'dequeue'}, {'reason': 'cancelled'},
                      {'commandUuid': 'invalid'}, {'deliveryId': None}, {'sessionId': None},
                      {'isMeta': True}, {'isSidechain': True}, {'content': ''}, {'content': ['not text']},
                      {'content': '<task-notification>worker finished</task-notification>'},
                      {'content': '<agent-message from="worker">worker result</agent-message>'},
                      {'content': 'Another Claude session sent a message:\nworker report'}]:
            with self.subTest(patch=patch):
                self.assertIsNone(display_message({**accepted, **patch}, 42))
        self.assertEqual(accepted['type'], 'queue-operation')

    def test_mid_turn_prompts_survive_live_reader_history_and_search_once(self):
        prompt = 'Please audit the full proof.'
        queued = {'type': 'queue-operation', 'operation': 'enqueue', 'sessionId': SESSION, 'content': prompt}
        delivered = {**queued, 'operation': 'remove', 'reason': 'absorbed_mid_turn',
                     'commandUuid': '775f0618-2ec6-49dd-8d51-807a74c3c7c7',
                     'deliveryId': 'd4240451-5037-430c-8ebb-1a5d694d579f'}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'conversation.jsonl'
            path.write_text(''.join(json.dumps(e)+'\n' for e in [event('user', 'Original question'),
                queued, delivered, event('assistant', 'Here is the audit.')]))
            messages = Reader(str(path)).update()
            self.assertEqual([m['text'] for m in messages], ['Original question', prompt, 'Here is the audit.'])
            self.assertEqual(read_history(str(path), 'start', 0)['messages'], messages)
            self.assertEqual([m['text'] for m in read_history(str(path), 'search', 0, 'full proof')['messages']], [prompt])

    def test_text_only_and_attribution(self):
        self.assertEqual(display_message(event('user', 'Question'), 0)['role'], 'user')
        answer = event('assistant', [{'type': 'thinking', 'thinking': 'private'},
                                    {'type': 'text', 'text': 'Conclusion'},
                                    {'type': 'tool_use', 'input': {'command': 'secret'}}])
        self.assertEqual(display_message(answer, 20)['text'], 'Conclusion')
        for e in [event('user', [{'type': 'tool_result', 'content': 'output'}]),
                  event('assistant', [{'type': 'thinking', 'thinking': 'private'}]),
                  event('user', 'internal', isMeta=True), event('user', 'summary', isCompactSummary=True),
                  event('assistant', 'worker', isSidechain=True),
                  event('user', '<task-notification>worker report</task-notification>')]:
            self.assertIsNone(display_message(e, 0))
        self.assertEqual(len(display_message(event('assistant', 'a'*70_000), 0)['text']), 64_000)

    def test_explicit_visible_progress_updates_are_assistant_messages(self):
        update = event('assistant', [{'type': 'thinking', 'thinking': 'I am checking the calculation.'}],
                       thinkingDisplay='updates', timestamp='2026-11-01T10:00:00Z')
        self.assertEqual(display_message(update, 42), {'id': '42', 'role': 'assistant',
            'text': 'I am checking the calculation.', 'truncated': False,
            'timestamp': '2026-11-01T10:00:00Z'})
        for overrides in ({'thinkingDisplay': None}, {'thinkingDisplay': 'full'},
                          {'thinkingDisplay': 'hidden'}, {'thinkingDisplay': 'unknown'},
                          {'isSidechain': True}, {'isMeta': True}, {'isCompactSummary': True},
                          {'type': 'user', 'message': {'role': 'user', 'content': update['message']['content']}}):
            with self.subTest(overrides=overrides):
                self.assertIsNone(display_message({**update, **overrides}, 42))
        mixed = event('assistant', [None, {'type': 'thinking', 'thinking': 'Checking.'},
                      {'type': ['invalid'], 'text': 'not a text block'},
                      {'type': 'text', 'text': 'The calculation agrees.'},
                      {'type': 'tool_use', 'input': {'command': 'hidden'}},
                      {'type': 'thinking', 'thinking': {'invalid': 'not text'}}], thinkingDisplay='updates')
        self.assertEqual(display_message(mixed, 0)['text'], 'Checking.\nThe calculation agrees.')
        large = event('assistant', [{'type': 'thinking', 'thinking': 'a'*70_000}], thinkingDisplay='updates')
        result = display_message(large, 0)
        self.assertEqual(len(result['text']), 64_000)
        self.assertTrue(result['truncated'])

    def test_visible_progress_updates_survive_live_history_and_search(self):
        update = event('assistant', [{'type': 'thinking', 'thinking': 'I am checking the calculation.'}],
                       thinkingDisplay='updates')
        hidden = event('assistant', [{'type': 'thinking', 'thinking': 'Private calculation.'}])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'conversation.jsonl'
            path.write_text(''.join(json.dumps(e)+'\n' for e in
                [event('user', 'Check the result.'), hidden, update, event('assistant', 'The result is correct.')]))
            messages = Reader(str(path)).update()
            self.assertEqual([m['text'] for m in messages],
                ['Check the result.', 'I am checking the calculation.', 'The result is correct.'])
            self.assertEqual(read_history(str(path), 'start', 0)['messages'], messages)
            self.assertEqual(read_history(str(path), 'search', 0, 'checking')['messages'], [messages[1]])
            self.assertEqual(read_history(str(path), 'search', 0, 'Private')['messages'], [])

    def test_registry_process_lifetime_identity_and_safe_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();(root/'sessions').mkdir();project=root/'projects/-work-math';project.mkdir(parents=True)
            record={'pid':123,'procStart':'456','sessionId':SESSION,'cwd':'/work/math','kind':'interactive','entrypoint':'cli'}
            registry=root/'sessions/123.json';registry.write_text(json.dumps(record))
            transcript=project/(SESSION+'.jsonl');transcript.write_text(json.dumps(event('user','question'))+'\n')
            self.assertEqual(match_session(root,'123','456','/work/math'),(str(transcript),SESSION))
            self.assertIsNone(match_session(root,'123','old','/work/math'))
            self.assertIsNone(match_session(root,'123','456','/work/other'))
            for patch in [{'entrypoint':'sdk-cli'},{'sessionId':'../../bad'},{'kind':'headless'},{'pid':99}]:
                registry.write_text(json.dumps({**record,**patch}))
                self.assertIsNone(match_session(root,'123','456','/work/math'))
            registry.write_text(json.dumps(record))
            transcript.write_text(json.dumps(event('user','other',sessionId='other'))+'\n')
            self.assertIsNone(match_session(root,'123','456','/work/math'))
            transcript.unlink()
            self.assertEqual(match_session(root,'123','456','/work/math'),(None,SESSION))
            other=root/'other';other.write_text(json.dumps(event('user','question'))+'\n');transcript.symlink_to(other)
            self.assertIsNone(match_session(root,'123','456','/work/math'))

    def test_reader_history_and_search_share_filter(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'conversation.jsonl'
            records=[event('user','Question'),event('assistant',[{'type':'tool_use','id':'t','name':'Bash','input':{'command':'echo hidden'}}]),event('user',[{'type':'tool_result','tool_use_id':'t','content':'hidden'}]),event('assistant',[{'type':'text','text':'Mathematical conclusion'}])]
            p.write_text(''.join(json.dumps(e)+'\n' for e in records))
            messages=Reader(str(p)).update()
            self.assertEqual([m['text'] for m in messages],['Question','Mathematical conclusion'])
            self.assertEqual(read_history(str(p),'start',0)['messages'],messages)
            self.assertEqual(len(read_history(str(p),'search',0,'conclusion')['messages']),1)
            self.assertEqual(read_history(str(p),'search',0,'hidden')['messages'],[])

    def test_activity_replaces_and_clears(self):
        a=Activity();a.update(event('assistant',[{'type':'tool_use','id':'t','name':'Bash','input':{'command':'ls'}}]))
        self.assertEqual(a.current['command'],'Bash\nls')
        a.update(event('user',[{'type':'tool_result','tool_use_id':'t','content':'x'*10_000}]))
        self.assertLessEqual(len(a.current['output']),4001)
        a.update({'type':'system','subtype':'turn_duration'})
        self.assertIsNone(a.current);self.assertFalse(a.turn_active)

    def test_literal_reply_to_mapped_claude(self):
        api=Mock(side_effect=lambda method,params: {'read':{'text':'❯ '}} if method=='pane.read' else
                 {'process_info':{'foreground_processes':[{'name':'claude'}]}})
        self.assertEqual(send_reply({'pane':'w7:p1','session':SESSION,'text':'Question'},lambda:{'w7:p1':(str(Path.home()/'.claude/projects/project'/f'{SESSION}.jsonl'),SESSION)},api),{'status':'sent'})
        api.assert_called_with('pane.send_input',{'pane_id':'w7:p1','text':'Question','keys':['Enter']})

    def test_first_reply_to_verified_empty_claude_is_literal_and_not_guessed(self):
        api=Mock(side_effect=lambda method,params: {'read':{'text':'❯ '}} if method=='pane.read' else
                 {'process_info':{'foreground_processes':[{'name':'claude','argv':['claude']}]}})
        self.assertEqual(send_reply({'pane':'w7:p1','session':SESSION,'text':'Question'},lambda:{'w7:p1':(None,SESSION)},api),{'status':'sent'})
        self.assertEqual(api.call_args.args,('pane.send_input',{'pane_id':'w7:p1','text':'Question','keys':['Enter']}))
        for processes in ([{'name':'claude','argv':['claude','--print']}],[{'name':'claude'},{'name':'codex'}]):
            api=Mock(return_value={'process_info':{'foreground_processes':processes}})
            with self.assertRaises(ReplyError):send_reply({'pane':'w7:p1','session':SESSION,'text':'Question'},lambda:{'w7:p1':(None,SESSION)},api)
            self.assertEqual(api.call_count,1)

    def test_no_reply_if_foreground_provider_changed(self):
        api=Mock(return_value={'process_info':{'foreground_processes':[{'name':'codex'}]}})
        path=str(Path.home()/'.claude/projects/project'/f'{SESSION}.jsonl')
        with self.assertRaises(ReplyError):
            send_reply({'pane':'w7:p1','session':SESSION,'text':'Question'},lambda:{'w7:p1':(path,SESSION)},api)
        self.assertEqual(api.call_count,1)
