import type { TabInfo } from "./types";

// Herdr's insert_index is a gap in the original list, before source removal.
export function tabMoveIndex(tabs: readonly TabInfo[], source: string, target: string, after: boolean) {
  const from = tabs.find(t => t.tab_id === source);
  const to = tabs.find(t => t.tab_id === target);
  if (!from || !to || from.workspace_id !== to.workspace_id || source === target) return null;
  const ordered = tabs.filter(t => t.workspace_id === from.workspace_id);
  const index = ordered.findIndex(t => t.tab_id === target) + Number(after);
  const fromIndex = ordered.findIndex(t => t.tab_id === source);
  return index === fromIndex || index === fromIndex + 1 ? null : index;
}
