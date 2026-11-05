import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { localFilePath, resolveConversationFile } from "./conversationFiles";
import { ActionMenu } from "./overlays";
import { outputUrl } from "./projectFiles";

export const ConversationFileContext = createContext<((path: string, action?: "reveal") => void) | null>(null);
export function ConversationFileLink({ href, children }: { href?: string; children: ReactNode }) {
  const open = useContext(ConversationFileContext);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const action = useRef<"reveal" | "copy" | undefined>(undefined);
  const [choices, setChoices] = useState<string[]>([]);
  if (/^https?:\/\//i.test(href ?? "")) return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  const path = localFilePath(href ?? "");
  if (!path || !open) return <span>{children}</span>;
  const select = async (file: string) => {
    if (action.current === "copy") {
      try {
        await navigator.clipboard.writeText(new URL(outputUrl("work", file), window.location.href).href);
        setNotice("Link copied.");
      } catch { setError("Could not copy the link. Check clipboard permissions and try again."); }
    } else if (action.current === "reveal") open(file, "reveal");
    else open(file);
  };
  const resolve = (nextAction?: "reveal" | "copy") => {
    if (busy) return;
    action.current = nextAction;
    const abort = new AbortController(); request.current = abort;
    setBusy(true); setError(""); setNotice(""); setChoices([]);
    void resolveConversationFile(path, abort.signal).then(async paths => {
      if (abort.signal.aborted) return;
      if (paths.length === 1) await select(paths[0]); else setChoices(paths);
    }).catch(failure => { if (!abort.signal.aborted) setError((failure as Error).message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
  };
  return <span><a href={outputUrl("work", path)} aria-busy={busy}
    onClick={event => { event.preventDefault(); resolve(); }}
    onContextMenu={event => { event.preventDefault(); event.currentTarget.focus(); setMenu({x: event.clientX, y: event.clientY}); }}
    onKeyDown={event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({x: rect.left, y: rect.bottom});
      }
    }}>{children}</a>{busy && <small role="status"> {action.current === "copy" ? "Copying…" : "Opening…"}</small>}
    {notice && <small role="status"> {notice}</small>}
    {error && <small role="alert"> {error}</small>}
    {choices.length > 0 && <span> {action.current === "copy" ? "Copy link from:" : "Open from:"} {choices.map(choice => <button key={choice} onClick={() => { void select(choice); setChoices([]); }}>{choice.split("/")[0]}</button>)}</span>}
    {menu && <ActionMenu {...menu} title={path.split("/").at(-1)}
      items={[{key: "open", label: "Open in viewer"}, {key: "reveal", label: "Reveal in Files"}, {key: "copy", label: "Copy link"}]}
      onClose={() => setMenu(null)} onPick={key => { setMenu(null); resolve(key === "reveal" || key === "copy" ? key : undefined); }} />}
  </span>;
}
