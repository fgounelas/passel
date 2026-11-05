import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneInfo, PaneScrollInfo } from "./types";

export function useTerminalScroll({ pane, connectionKey, httpUrl, send }: {
  pane: PaneInfo | null; connectionKey: string;
  httpUrl: (path: string) => string; send: (lines: number) => boolean;
}) {
  const [scroll, setScroll] = useState(pane?.scroll);
  const current = useRef(scroll);
  const target = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useRef<AbortController | null>(null);
  const latest = useRef({ pane, httpUrl, send });
  latest.current = { pane, httpUrl, send };
  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    refresh.current?.abort();
    refresh.current = null;
  }, []);
  useEffect(() => {
    stop();
    current.current = latest.current.pane?.scroll;
    setScroll(current.current);
    return stop;
  }, [pane?.pane_id, connectionKey, stop]);
  useEffect(() => {
    if (timer.current === null && !refresh.current) {
      current.current = pane?.scroll;
      setScroll(pane?.scroll);
    }
  }, [pane?.scroll]);

  const move = useCallback((value: number, relative: boolean) => {
    const info = current.current;
    if (!info || (relative && !info.max_offset_from_bottom)) {
      if (relative) latest.current.send(Math.max(-200, Math.min(200, Math.round(value))));
      return;
    }
    const destination = relative
      ? (timer.current !== null ? target.current : info.offset_from_bottom) - value
      : value;
    target.current = Math.max(0, Math.min(info.max_offset_from_bottom, Math.round(destination)));
    stop();
    const publish = (next: PaneScrollInfo) => { current.current = next; setScroll(next); };
    const pump = () => {
      timer.current = null;
      const active = current.current;
      if (!active) return;
      const lines = Math.max(-200, Math.min(200, active.offset_from_bottom - target.current));
      if (lines && !latest.current.send(lines)) return;
      const next = { ...active, offset_from_bottom: active.offset_from_bottom - lines };
      publish(next);
      if (next.offset_from_bottom !== target.current) {
        timer.current = setTimeout(pump, 32);
        return;
      }
      // Reconcile with the server after its scroll frames have been processed.
      // No idle polling: normal app snapshots update the scrollbar otherwise.
      timer.current = setTimeout(() => {
        timer.current = null;
        const abort = new AbortController();
        refresh.current = abort;
        const paneId = latest.current.pane?.pane_id;
        void fetch(latest.current.httpUrl("/api/snapshot"), { signal: abort.signal, cache: "no-store" })
          .then(async response => {
            if (!response.ok) return;
            const snapshot = await response.json() as { panes: PaneInfo[] };
            const fresh = snapshot.panes.find(p => p.pane_id === paneId)?.scroll;
            if (!abort.signal.aborted && fresh) publish(fresh);
          }).catch(() => {}).finally(() => { if (refresh.current === abort) refresh.current = null; });
      }, 150);
    };
    pump();
  }, [stop]);
  return { scroll, scrollBy: useCallback((lines: number) => move(lines, true), [move]),
    scrollTo: useCallback((offset: number) => move(offset, false), [move]) };
}
