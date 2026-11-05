import { expect, it } from "vitest";
import { tabMoveIndex } from "./tabReorder";
import { tabReorderBucket, buildVisibleTabWorkspaceGroups } from "./App";
import type { TabInfo, Snapshot, PaneInfo } from "./types";
const tabs = ["a", "b", "c"].map((id, index) => ({tab_id:id, workspace_id:"w", number:index+1, label:id, focused:false, pane_count:1, agent_status:"idle"} as TabInfo));
it("uses original-list insertion gaps and rejects no-ops and cross-workspace moves", () => {
  expect(tabMoveIndex(tabs,"a","c",true)).toBe(3);
  expect(tabMoveIndex(tabs,"c","a",false)).toBe(0);
  expect(tabMoveIndex(tabs,"a","b",false)).toBeNull();
  expect(tabMoveIndex(tabs,"b","a",true)).toBeNull();
  expect(tabMoveIndex(tabs,"b","b",true)).toBeNull();
  expect(tabMoveIndex([...tabs,{...tabs[0],tab_id:"other",workspace_id:"other"}],"a","other",false)).toBeNull();
});
it("allows working DPC and idle terminal to reorder while keeping shells below agents", () => {
  const panes = tabs.map((t,i) => ({pane_id:t.tab_id, terminal_id:t.tab_id, tab_id:t.tab_id, workspace_id:"w", agent:i ? "codex" : undefined, agent_status:i === 1 ? "working" : i === 2 ? "idle" : "unknown"} as PaneInfo));
  const snapshot = {tabs,panes,workspaces:[],layouts:[]} as Snapshot;
  expect(tabReorderBucket(snapshot,"b","attention","primary")).toBe(tabReorderBucket(snapshot,"c","attention","primary"));
  expect(tabReorderBucket(snapshot,"a","attention","primary")).not.toBe(tabReorderBucket(snapshot,"b","attention","primary"));
  const scoped = {bridgeId:"primary",bridgeIndex:0,bridgeLabel:"primary",bridgeColor:"",snapshot,workspace:{workspace_id:"w"}};
  const order = () => buildVisibleTabWorkspaceGroups([scoped as Parameters<typeof buildVisibleTabWorkspaceGroups>[0][number]],new Set(),false,true,"attention")[0].tabs.map(t => t.tab.tab_id);
  expect(order()).toEqual(["b","c","a"]);
  snapshot.tabs = [tabs[0], tabs[2], tabs[1]];
  expect(order()).toEqual(["c","b","a"]);
  snapshot.panes[1].agent_status = "blocked";
  snapshot.panes[2].agent_status = "working";
  expect(order()).toEqual(["c","b","a"]);
});
