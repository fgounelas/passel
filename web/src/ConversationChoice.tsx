import { useEffect, useRef, useState } from "react";
import { isClaudeLoginUrl } from "./claudeLogin";
type Choice = {active: boolean; provider?: "codex" | "claude"; kind?: "login"; loginUrl?: string; context?: string; options?: {number:number;label:string;selected:boolean}[]; canNavigate?: boolean; isOpen?: boolean; canAnswer?: boolean; token?: string; frame?: string; text?: string};
type Action = "inspect" | "open" | "up" | "down" | "select" | "cancel" | "answer" | "main" | "choose";
export async function choiceRequest(pane: string, action: Action, state?: Choice, signal?: AbortSignal, text?: string, number?: number): Promise<Choice> {
  const response = await fetch('/api/project-files/conversation/choice', {method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {'Content-Type':'application/json', 'X-Herdr-Conversation':'1'},
    body: JSON.stringify({pane, action, ...(action === 'inspect' ? {} : {token:state?.token, frame:state?.frame}), ...(action === 'answer' ? {text} : {}), ...(action === 'choose' ? {number} : {})}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000)});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Choice controls are temporarily unavailable.');
  if (typeof value.active !== 'boolean' || (value.active && (typeof value.text !== 'string' || value.text.length > 12001 || typeof value.token !== 'string' || typeof value.frame !== 'string'))) throw new Error('Invalid choice prompt.');
  if (value.kind === 'login' && (value.provider !== 'claude' || !isClaudeLoginUrl(value.loginUrl))) throw new Error('Invalid sign-in link.');
  if (value.provider === 'claude' && value.kind !== 'login' && (typeof value.context !== 'string' || value.context.length > 12001 || !Array.isArray(value.options) || value.options.length > 10 || value.options.some((o: {number:unknown;label:unknown;selected:unknown})=>!Number.isInteger(o.number) || typeof o.label !== 'string' || o.label.length > 12001 || typeof o.selected !== 'boolean'))) throw new Error('Invalid approval options.');
  return value;
}
export function ConversationChoice({pane, onActive, onLogin}: {pane:string; onActive?:(active:boolean)=>void; onLogin?:(url:string|null)=>void}) {
  const [state,setState] = useState<Choice>({active:false});
  const [busy,setBusy] = useState(false);
  const [answer,setAnswer] = useState('');
  const [error,setError] = useState('');
  const sending = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    onActive?.(state.active);
    onLogin?.(state.active && state.kind === 'login' ? state.loginUrl ?? null : null);
  }, [state, onActive, onLogin]);
  useEffect(() => () => { onLogin?.(null); onActive?.(false); }, [onLogin, onActive]);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController(); let polling = false;
    const poll = async () => {
      if (document.hidden || sending.current || polling) return;
      polling = true; const revision = generation.current;
      try {const next = await choiceRequest(pane,'inspect',undefined,abort.signal);
        if (!abort.signal.aborted && revision === generation.current) setState(next);}
      catch { if (!abort.signal.aborted) setState(previous => previous.kind === 'login' ? {active:false} : previous); }
      finally {polling=false;}
    };
    void poll(); const timer=setInterval(()=>void poll(),3000);
    return () => {mounted.current=false;abort.abort();clearInterval(timer);};
  },[pane]);
  const send = async (action: Action, number?: number) => {
    if(sending.current)return;
    sending.current=true;generation.current++;setBusy(true);setError('');
    try {const next=await choiceRequest(pane,action,state,undefined,answer,number);if(mounted.current){setState(next);onActive?.(next.active);if(action==='answer')setAnswer('');}}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not send choice.');}
    finally {sending.current=false;if(mounted.current)setBusy(false);}
  };
  if(!state.active)return null;
  if(state.kind === 'login') return null;
  const claude = state.provider === 'claude';
  return <section className="conversation-choice" aria-label={claude ? "Claude choices" : "Codex choices"}>
    <strong>{claude ? "Claude is waiting for approval" : "Codex is waiting for your input"}</strong>
    <pre tabIndex={0} aria-label="Current question and options">{claude ? state.context : state.text}</pre>
    {claude && <div className="conversation-choice-options">{state.options?.map(option=><button key={option.number}
      type="button" className="btn" disabled={busy} data-selected={option.selected} onClick={()=>void send('choose',option.number)}>
      {option.number}. {option.label}
    </button>)}</div>}
    {error && <p role="alert">{error}</p>}
    {state.canAnswer && <label className="conversation-choice-answer">Your answer
      <textarea aria-label="Answer this question" value={answer} maxLength={16000} disabled={busy} onChange={e=>setAnswer(e.target.value)} rows={2}/>
    </label>}
    <div className="conversation-choice-actions">
      {!state.isOpen && <button type="button" className="btn" disabled={busy} onClick={()=>void send('open')}>Open choices <span aria-hidden="true">Alt+↑</span></button>}
      {state.canAnswer && <button type="button" className="btn" disabled={busy || !answer.trim()} onClick={()=>void send('answer')}>Submit answer</button>}
      {state.canNavigate && <>
      <button type="button" className="btn" aria-label="Previous choice" disabled={busy || !state.canNavigate} onClick={()=>void send('up')}>↑</button>
      <button type="button" className="btn" aria-label="Next choice" disabled={busy || !state.canNavigate} onClick={()=>void send('down')}>↓</button>
      <button type="button" className="btn" disabled={busy || !state.canNavigate} onClick={()=>void send('select')}>Select</button>
      <button type="button" className="btn" disabled={busy || !state.canNavigate} onClick={()=>void send('cancel')}>Back</button></>}
      {state.isOpen && !claude && <button type="button" className="btn" disabled={busy} onClick={()=>void send('main')}>Main prompt</button>}
    </div>
  </section>;
}
