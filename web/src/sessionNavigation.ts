import type { PaneInfo } from "./types";
export type SessionFilter = "all" | "working" | "attention";
export type SessionCollection = "current" | "archived";
export function matchesSessionFilter(panes: PaneInfo[], filter: SessionFilter, closed = false) {
  if (filter === "all") return true;
  if (closed) return false;
  return panes.some(pane => pane.agent_status === (filter === "working" ? "working" : "blocked"));
}
export function sessionStatus(panes: PaneInfo[], closed = false): string {
  if (closed) return "Session closed";
  if (panes.some(pane => pane.agent_status === "blocked")) return "Waiting for input";
  if (panes.some(pane => pane.agent_status === "working")) return "Working";
  return panes.some(pane => pane.agent || pane.display_agent) ? "Idle" : "Terminal";
}
export function migrateSidebarView(value: unknown): "tabs" | "files" | "notes" {
  return value === "files" || value === "notes" ? value : "tabs";
}

export function canQuitSession(panes: PaneInfo[]) {
  return panes.length === 1 && [panes[0].agent, panes[0].display_agent]
    .some(agent => agent && ["codex", "claude"].includes(agent.toLowerCase()));
}


export function sessionAgentName(pane: PaneInfo): string {
  const agent = pane.agent?.trim() || pane.display_agent?.trim();
  if (!agent) return "Terminal";
  const labels: Record<string, string> = {codex: "Codex", claude: "Claude", pi: "Pi", opencode: "OpenCode", grok: "Grok"};
  return labels[agent.toLowerCase()] || agent;
}
