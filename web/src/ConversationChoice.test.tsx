// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {ConversationChoice} from './ConversationChoice';
it('shows clickable Claude approval options and sends only the explicitly chosen option',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const state={active:true,provider:'claude',context:'Bash command\nbash scripts/services.sh up verify\nDo you want to proceed?',text:'full prompt',options:[{number:1,label:'Yes',selected:true},{number:2,label:'No',selected:false}],isOpen:true,canNavigate:true,token:'1:2',frame:'f'};
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>state}).mockResolvedValue({ok:true,json:async()=>({active:false})});
  vi.stubGlobal('fetch',fetcher);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<ConversationChoice pane="w3:p2" onActive={vi.fn()}/>));
    expect(host.textContent).toContain('Claude is waiting for approval');
    expect(host.textContent).toContain('bash scripts/services.sh up verify');
    expect(host.textContent).not.toContain('Main prompt');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()==='2. No')!.click());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({pane:'w3:p2',action:'choose',number:2,token:'1:2',frame:'f'});
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it('shows a persistent prompt and only sends a key after an explicit click, with no retry on conflict',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({active:true,canNavigate:true,token:'1:2',frame:'f',text:'Question\n1. Continue\n2. Stop'})})
    .mockResolvedValue({ok:false,json:async()=>({error:'The choice prompt changed.'})});
  vi.stubGlobal('fetch',fetcher);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const active=vi.fn();
  try{
    await act(async()=>root.render(<ConversationChoice pane="w1:p1" onActive={active}/>));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('1. Continue');
    expect(active).toHaveBeenCalledWith(true);
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Select')!.click());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({pane:'w1:p1',action:'select',token:'1:2',frame:'f'});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('prompt changed');
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it('offers an answer field instead of inactive choice arrows for an open text question',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const state={active:true,isOpen:true,canAnswer:true,canNavigate:false,token:'1:2',frame:'f',text:'Do you have the PDF?\nType your answer\nenter submit'};
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>state}).mockResolvedValue({ok:true,json:async()=>({active:false})});
  vi.stubGlobal('fetch',fetcher);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const active=vi.fn();
  try{
    await act(async()=>root.render(<ConversationChoice pane="w1:p1" onActive={active}/>));
    expect(host.textContent).not.toContain('Open choices');
    expect(host.querySelector('[aria-label="Next choice"]')).toBeNull();
    const input=host.querySelector('textarea')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'It is in uploads.');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Submit answer')!.click());
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({pane:'w1:p1',action:'answer',token:'1:2',frame:'f',text:'It is in uploads.'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
