import {expect,it} from 'vitest';
import {sessionAgentName,canQuitSession,matchesSessionFilter,migrateSidebarView,sessionStatus} from './sessionNavigation';
import type {PaneInfo} from './types';
const pane=(status:PaneInfo['agent_status'],agent:string|undefined='codex')=>({pane_id:'p',tab_id:'t',workspace_id:'w',terminal_id:'term',focused:false,revision:1,agent_status:status,agent}) as PaneInfo;
it('migrates both old sidebar views into Sessions while retaining Files and Notes',()=>{
  for(const value of ['agents','tabs',undefined,'invalid'])expect(migrateSidebarView(value)).toBe('tabs');
  expect(migrateSidebarView('files')).toBe('files');expect(migrateSidebarView('notes')).toBe('notes');
});
it('filters whole sessions by working/attention and preserves closed sessions only in All',()=>{
  expect(matchesSessionFilter([pane('idle'),pane('working')],'working')).toBe(true);
  expect(matchesSessionFilter([pane('blocked')],'attention')).toBe(true);
  expect(matchesSessionFilter([pane('working')],'attention')).toBe(false);
  expect(matchesSessionFilter([pane('working')],'working',true)).toBe(false);
  expect(matchesSessionFilter([],'all',true)).toBe(true);
  expect(sessionStatus([pane('working'),pane('blocked')])).toBe('Waiting for input');
  expect(sessionStatus([pane('working')],true)).toBe('Session closed');
});

it('offers quit only for a single supported agent pane',()=>{
  expect(canQuitSession([pane('idle','claude')])).toBe(true);
  expect(canQuitSession([pane('idle','codex')])).toBe(true);
  expect(canQuitSession([pane('idle','opencode')])).toBe(false);
  expect(canQuitSession([pane('idle','')])).toBe(false);
  expect(canQuitSession([pane('idle','claude'),pane('idle','codex')])).toBe(false);
});


it('uses the detected agent as the subtitle instead of repeating a custom session name',()=>{
  expect(sessionAgentName({...pane('idle','codex'),display_agent:'Custom project'})).toBe('Codex');
  expect(sessionAgentName(pane('idle','claude'))).toBe('Claude');
  expect(sessionAgentName(pane('unknown',''))).toBe('Terminal');
});
