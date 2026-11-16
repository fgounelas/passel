import { expect, it } from 'vitest';
import { claudeLoginLink, isClaudeLoginUrl } from './claudeLogin';
const url='https://claude.ai/oauth/authorize?client_id=test-client&response_type=code&code_challenge=syntheticChallengeABCDEFGHIJKLMNOPQRSTUVWXYZ&state=syntheticStateABCDEFGHIJKLMNOPQRSTUVWXYZ';
it('accepts the current claude.com login route with the copy-key heading and explicit row breaks',()=>{
  const current=url.replace('claude.ai/oauth','claude.com/cai/oauth')+'&scope='+'synthetic%3Ascope%20'.repeat(7);
  const parts=current.match(/.{1,185}/g)!;
  expect(claudeLoginLink(["Browser didn't open? Use the url below to sign in (c to copy)",'',...parts,'','Paste code here if prompted >'])).toEqual({url:current,firstRow:2,lastRow:parts.length+1});
  for(const invalid of [current.replace('/cai/oauth','/oauth'),current.replace('claude.com/','claude.ai/'),current.replace('claude.com/','claude.com.attacker.test/')]) expect(isClaudeLoginUrl(invalid)).toBe(false);
});
it('joins hard-wrapped login links at every character, retaining opaque query values',()=>{
  for(let width=25;width<url.length;width++) {
    const parts=url.match(new RegExp(`.{1,${width}}`,'g'))!;
    expect(claudeLoginLink(["Browser didn't open? Use the url below to sign in:",'',...parts.map(p=>'  '+p),'','Paste code here if prompted >'])).toEqual({url,firstRow:2,lastRow:parts.length+1});
  }
});
it('only accepts complete HTTPS provider authorization URLs in an explicit login screen',()=>{
  expect(claudeLoginLink([url])).toBeNull();
  for(const invalid of [url.replace('claude.ai','evil.test'),url.replace('https:','http:'),url.replace('claude.ai','user@claude.ai'),url.replace('client_id','missing'),url+'#fragment',url+'x'.repeat(9000)]) expect(isClaudeLoginUrl(invalid)).toBe(false);
});
