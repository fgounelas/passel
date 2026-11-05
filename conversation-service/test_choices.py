import unittest
from unittest.mock import Mock,patch
from choices import choice_request,choice_screen,claude_approval,inspect_choice
from replies import ReplyError
from collector import match_blocked_thread

class Choices(unittest.TestCase):
    def test_codex_choice_inspection_ignores_scrolled_viewport(self):
        api=Mock(side_effect=lambda method,params:
                 {'process_info':{'foreground_processes':[{'pid':12,'name':'codex'}]}} if method=='pane.process_info' else
                 {'pane':{'agent_status':'working'}} if method=='pane.get' else
                 {'read':{'text':'Queued follow-up inputs\n1 question\nalt+↑ to answer'
                          if params['source']=='detection' else 'Older mathematical answer'}})
        with patch('choices.identity',return_value={'start':'lifetime'}):
            self.assertTrue(inspect_choice('w3:p2',api)['active'])
        self.assertFalse(any(call.args[0]=='pane.send_input' for call in api.call_args_list))

    def test_claude_command_approval_is_bounded_and_keeps_command_context(self):
        text='older transcript\nBash command\nbash scripts/services.sh up verify\nThis command requires approval\nDo you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don’t ask again for: bash scripts/services.sh up verify\n   3. Yes, and switch to auto mode\n      auto mode handles these prompts\n   4. No\n\nEsc to cancel · Tab to amend'
        prompt,options,context,stable=claude_approval(text)
        self.assertTrue(context.startswith('Bash command'))
        self.assertIn('bash scripts/services.sh up verify',context)
        self.assertNotIn('older transcript',prompt)
        self.assertEqual(options[2]['label'],'Yes, and switch to auto mode auto mode handles these prompts')
        self.assertEqual(claude_approval(text.replace(' ❯ 1.','   1.').replace('   4.',' ❯ 4.'))[-1],stable)
        for invalid in (text.replace(' ❯ 1.','   1.'),text.replace('   4.',' ❯ 4.'),text.replace('Do you want to proceed?','Mathematics'),text.replace('   4.','   7.')):
            self.assertIsNone(claude_approval(invalid))

    def test_claude_inspection_checks_owned_interactive_registry_and_never_sends(self):
        text='Bash command\necho inspect\nThis command requires approval\nDo you want to proceed?\n ❯ 1. Yes\n   2. No\n\nEsc to cancel'
        def api(method,params):
            if method=='pane.process_info':return {'process_info':{'foreground_processes':[{'pid':12,'name':'claude'},{'pid':99,'name':'claude'}]}}
            if method=='pane.get':return {'pane':{'agent':'claude'}}
            if method=='pane.read':
                self.assertEqual(params['source'],'detection')
                return {'read':{'text':text}}
            self.fail('Inspection sent input')
        def process(pid,*args):
            if pid==99:raise ReplyError(409,'SDK worker')
            return {'start':'lifetime','profile':'/profile','cwd':'/project'}
        with patch('choices.identity',side_effect=process),patch('choices.claude.match_session',return_value=('path','session')):
            state=inspect_choice('w3:p2',api)
            self.assertEqual(state['provider'],'claude')
            self.assertTrue(state['isOpen']);self.assertTrue(state['canNavigate'])
            self.assertEqual(state['token'],'12:lifetime')
        with patch('choices.identity',side_effect=process),patch('choices.claude.match_session',return_value=None):
            self.assertFalse(inspect_choice('w3:p2',api)['active'])

    def test_claude_option_click_stages_arrows_then_rechecks_before_enter(self):
        state={'active':True,'provider':'claude','token':'2:3','frame':'f','question':'cmd','canNavigate':True,
               'options':[{'number':1,'selected':True},{'number':2,'selected':False}]}
        selected={**state,'frame':'next','options':[{'number':1,'selected':False},{'number':2,'selected':True}]}
        body={'operation':'choice','pane':'w3:p2','action':'choose','token':'2:3','frame':'f','number':2}
        api=Mock()
        with patch('choices.inspect_choice',side_effect=[state,selected,{'active':False}]),patch('choices.time.sleep'):
            self.assertFalse(choice_request(body,api)['active'])
            self.assertEqual([call.args for call in api.call_args_list],[('pane.send_input',{'pane_id':'w3:p2','keys':['Down']}),('pane.send_input',{'pane_id':'w3:p2','keys':['Enter']})])
        for changed in ({**selected,'question':'different command'},{**selected,'token':'new process'},state):
            api=Mock()
            with patch('choices.inspect_choice',side_effect=[state,changed]),patch('choices.time.sleep'):
                with self.assertRaises(ReplyError):choice_request(body,api)
            self.assertEqual(api.call_args.args,('pane.send_input',{'pane_id':'w3:p2','keys':['Down']}))
            self.assertEqual(api.call_count,1)
        for change in ({'frame':'stale'},{'number':True},{'number':8}):
            api=Mock()
            with patch('choices.inspect_choice',return_value=state),patch('choices.time.sleep'):
                with self.assertRaises(ReplyError):choice_request({**body,**change},api)
            api.assert_not_called()

    def test_only_fixed_keys_and_select_requires_matching_displayed_frame(self):
        state={'active':True,'token':'2:3','frame':'hash','text':'Question','canNavigate':True}
        api=Mock()
        with patch('choices.inspect_choice',return_value=state),patch('choices.time.sleep'):
            for action,key in [('open','Alt+Up'),('up','Up'),('down','Down'),('select','Enter'),('cancel','Escape')]:
                self.assertEqual(choice_request({'operation':'choice','pane':'w1:p1','action':action,'token':'2:3','frame':'hash'},api),state)
                api.assert_called_with('pane.send_input',{'pane_id':'w1:p1','keys':[key]})
            api.reset_mock()
            for body in [{'action':'select','token':'2:3','frame':'stale'}, {'action':'open','token':'other','frame':'hash'}, {'action':'kill','token':'2:3','frame':'hash'}]:
                with self.assertRaises(ReplyError):choice_request({'operation':'choice','pane':'w1:p1',**body},api)
            api.assert_not_called()
    def test_closed_prompt_cannot_receive_enter(self):
        api=Mock()
        with patch('choices.inspect_choice',return_value={'active':False}):
            with self.assertRaises(ReplyError):choice_request({'operation':'choice','pane':'w1:p1','action':'select','token':'2:3','frame':'h'},api)
        api.assert_not_called()
    def test_collapsed_queue_cannot_receive_enter(self):
        api=Mock()
        with patch('choices.inspect_choice',return_value={'active':True,'token':'2:3','frame':'h','canNavigate':False}):
            with self.assertRaises(ReplyError):choice_request({'operation':'choice','pane':'w1:p1','action':'select','token':'2:3','frame':'h'},api)
        api.assert_not_called()
    def test_choice_detection_and_bound_attachment(self):
        self.assertTrue(choice_screen({},'Queued follow-up inputs'))
        self.assertTrue(choice_screen({'agent_status':'blocked'},'Approval'))
        self.assertFalse(choice_screen({'agent_status':'working'},'ordinary math'))
        previous={'caption':'Known thread | project','thread':'thread'}
        with patch('collector.match_daemon_thread',side_effect=[None,('path','thread')]) as match:
            self.assertEqual(match_blocked_thread('profile',{'agent_status':'blocked'},set(),None,previous,''),('path','thread'))
            self.assertEqual(match.call_args.args[1]['terminal_title_stripped'],previous['caption'])
        with patch('collector.match_daemon_thread',return_value=None) as match:
            self.assertIsNone(match_blocked_thread('profile',{'agent_status':'working'},set(),None,previous,'normal'))
            self.assertEqual(match.call_count,1)
        with patch('collector.match_daemon_thread',side_effect=[None,('wrong','other')]):
            self.assertIsNone(match_blocked_thread('profile',{'agent_status':'blocked'},set(),None,previous,''))

    def test_modern_free_text_prompt_and_stable_question_frame(self):
        from choices import prompt_state
        question='• Queued follow-up inputs\n\nDo you have the PDF?\n\n  Type your answer\n\n  enter submit   ctrl+] skip   alt+↓ main prompt'
        a=prompt_state('• Working (1s)\n'+question)
        b=prompt_state('• Working (2s)\n'+question)
        self.assertEqual(a,b)
        self.assertEqual(a,(question,True,True))
        self.assertEqual(prompt_state('Question 1/1\n1. Yes\n2. No\nenter select')[1:],(True,False))
        self.assertEqual(prompt_state('Queued follow-up inputs\n1 question\nalt+↑ to answer')[1:],(False,False))

    def test_free_text_answer_bound_to_empty_current_question(self):
        state={'active':True,'token':'2:3','frame':'hash','text':'Question','canNavigate':False,'isOpen':True,'canAnswer':True}
        api=Mock()
        body={'operation':'choice','pane':'w1:p1','action':'answer','token':'2:3','frame':'hash','text':'The PDF is in uploads.'}
        with patch('choices.inspect_choice',return_value=state),patch('choices.time.sleep'):
            choice_request(body,api)
            api.assert_called_once_with('pane.send_input',{'pane_id':'w1:p1','text':body['text'],'keys':['Enter']})
            api.reset_mock()
            for change in ({'frame':'old'},{'token':'old'},{'text':'\x1b[A'},{'text':' '},{'text':'a'*16001}):
                with self.assertRaises(ReplyError):choice_request({**body,**change},api)
            state['canAnswer']=False
            with self.assertRaises(ReplyError):choice_request(body,api)
            api.assert_not_called()

    def test_open_does_not_toggle_an_already_open_question(self):
        api=Mock()
        state={'active':True,'token':'2:3','frame':'hash','isOpen':True}
        with patch('choices.inspect_choice',return_value=state),patch('choices.time.sleep'):
            choice_request({'operation':'choice','pane':'w1:p1','action':'open','token':'2:3','frame':'hash'},api)
        api.assert_not_called()
