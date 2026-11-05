import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type ArchiveAction = "archive" | "restore" | "quit" | "resume";
export async function archiveRequest(action: "list" | ArchiveAction, tab?: string, signal?: AbortSignal): Promise<{tabs: Set<string>; stopped: Set<string>}> {
  const response = await fetch("/api/project-files/conversation/archives", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Herdr-Conversation": "1" },
    body: JSON.stringify(action === "list" ? { action } : { action, tab }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const value = await response.json().catch(() => {
    throw new Error("The archive service was temporarily unavailable. Check Current and Archived before trying again.");
  });
  if (!value || typeof value !== "object") throw new Error("Invalid archive response.");
  if (!response.ok) throw new Error(value.error || "Could not update archived tabs.");
  if (!Array.isArray(value.tabs) || value.tabs.length > 1000 || value.tabs.some((id: unknown) =>
    typeof id !== "string" || !/^[A-Za-z0-9:._-]{1,100}$/.test(id))) throw new Error("Invalid archive response.");
  if (!Array.isArray(value.stopped) || value.stopped.length > 1000 || value.stopped.some((id: unknown) =>
    typeof id !== "string" || !/^[A-Za-z0-9:._-]{1,100}$/.test(id))) throw new Error("Invalid archive response.");
  return { tabs: new Set(value.tabs), stopped: new Set(value.stopped) };
}

const empty = new Set<string>();
const initial = {tabs: empty, stopped: empty};
const Context = createContext({ tabs: empty, stopped: empty, ready: false, busy: false,
  change: (async () => { throw new Error("Archive unavailable."); }) as (tab: string, action: ArchiveAction) => Promise<void> });
export const useTabArchives = () => useContext(Context);

export function TabArchivesProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [state, setState] = useState(initial);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let polling = false;
    const refresh = async () => {
      if (document.hidden || changing.current || polling) return;
      polling = true;
      const version = revision.current;
      try {
        const next = await archiveRequest("list", undefined, controller.signal);
        if (!controller.signal.aborted && version === revision.current) {
          setState(previous => previous.tabs.size === next.tabs.size && [...next.tabs].every(id => previous.tabs.has(id)) &&
            previous.stopped.size === next.stopped.size && [...next.stopped].every(id => previous.stopped.has(id)) ? previous : next);
          setReady(true);
        }
      } catch { /* Keep known state on temporary failures; unsupported servers have no archive controls. */ }
      finally { polling = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled]);
  const change = useCallback(async (tab: string, action: ArchiveAction) => {
    if (changing.current) throw new Error("An archive change is already in progress.");
    changing.current = true;
    revision.current++;
    setBusy(true);
    try { setState(await archiveRequest(action, tab)); }
    finally { changing.current = false; setBusy(false); }
  }, []);
  const value = useMemo(() => ({ ...(enabled ? state : initial), ready: enabled && ready, busy, change }), [state, ready, busy, change, enabled]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
