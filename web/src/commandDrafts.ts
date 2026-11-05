import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type PendingConversationMessage = { id: string; text: string; session: string; first: boolean; knownIds: string[]; sent: boolean; sentAt?: number; unconfirmed?: boolean };
const NO_OUTGOING: PendingConversationMessage[] = [];

/** Owned by one App mount: drafts never leave this browser tab or survive a reload. */
export function createCommandDraftStore() {
  const drafts = new Map<string, Map<string, string>>();
  const outgoing = new Map<string, PendingConversationMessage[]>();
  const key = (bridge: string, pane: string) => JSON.stringify([bridge, pane]);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    get(bridgeId: string, paneId: string) {
      return drafts.get(bridgeId)?.get(paneId) ?? "";
    },
    set(bridgeId: string, paneId: string, value: string) {
      const panes = drafts.get(bridgeId) ?? new Map<string, string>();
      if ((panes.get(paneId) ?? "") === value) return;
      if (value) panes.set(paneId, value);
      else panes.delete(paneId);
      if (panes.size) drafts.set(bridgeId, panes);
      else drafts.delete(bridgeId);
      notify();
    },
    getOutgoing(bridge: string, pane: string) {
      return outgoing.get(key(bridge, pane)) ?? NO_OUTGOING;
    },
    updateOutgoing(bridge: string, pane: string, update: (value: PendingConversationMessage[]) => PendingConversationMessage[]) {
      const id = key(bridge, pane);
      const previous = outgoing.get(id) ?? NO_OUTGOING;
      const next = update(previous).slice(-10);
      if (next.length === previous.length && next.every((entry, i) => entry === previous[i])) return;
      if (next.length) outgoing.set(id, next); else outgoing.delete(id);
      notify();
    },
    /** Call only with a successful, current, complete bridge snapshot. */
    retainPanes(bridgeId: string, paneIds: readonly string[]) {
      const panes = drafts.get(bridgeId);
      const live = new Set(paneIds);
      let changed = false;
      for (const id of outgoing.keys()) {
        const [bridge, pane] = JSON.parse(id) as string[];
        if (bridge === bridgeId && !live.has(pane)) { outgoing.delete(id); changed = true; }
      }
      if (!panes) { if (changed) notify(); return; }
      for (const paneId of panes.keys()) {
        if (!live.has(paneId)) {
          panes.delete(paneId);
          changed = true;
        }
      }
      if (!panes.size) drafts.delete(bridgeId);
      if (changed) notify();
    },
  };
}

export const CommandDraftContext = createContext<ReturnType<typeof createCommandDraftStore> | null>(null);

export function useCommandDraft(bridgeId: string, paneId: string) {
  const store = useContext(CommandDraftContext);
  if (!store) throw new Error("Command composer requires an app draft store");
  const getSnapshot = useCallback(() => store.get(bridgeId, paneId), [store, bridgeId, paneId]);
  const value = useSyncExternalStore(store.subscribe, getSnapshot);
  const setValue = (next: string, expected?: string) => {
    if (expected !== undefined && store.get(bridgeId, paneId) !== expected) return;
    store.set(bridgeId, paneId, next);
  };
  return [value, setValue] as const;
}

export function useConversationOutgoing(bridgeId: string, paneId: string) {
  const store = useContext(CommandDraftContext);
  if (!store) throw new Error("Conversation requires an app draft store");
  const getSnapshot = useCallback(() => store.getOutgoing(bridgeId, paneId), [store, bridgeId, paneId]);
  const value = useSyncExternalStore(store.subscribe, getSnapshot);
  const update = useCallback((fn: (value: PendingConversationMessage[]) => PendingConversationMessage[]) =>
    store.updateOutgoing(bridgeId, paneId, fn), [store, bridgeId, paneId]);
  return [value, update] as const;
}
