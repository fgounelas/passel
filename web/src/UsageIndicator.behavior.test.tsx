/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UsageIndicator, {type Quota} from "./UsageIndicator";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ""; });
function quota(): Quota {
  return {provider: "codex", account: "account@example.test", accountKey: "a".repeat(64), status: "ok", observedAt: Date.now() / 1000,
    windows: [{bucket: "codex", minutes: 10080, remaining: 12, resetsAt: null}],
    credits: [{bucket: "codex", balance: "150.5", hasCredits: true, unlimited: false}],
    bankedResets: {availableCount: 1, credits: [{id: "one", title: "Banked weekly reset", status: "available", resetType: "codexRateLimits",
      expiresAt: Date.now() / 1000 + 86400, expiryKnown: true}]}};
}
it("dismisses usage on an outside click, focus or Escape while retaining inside interactions", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(quota()))));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const outside = document.createElement("button"); document.body.append(outside);
  try {
    await act(async () => root.render(<UsageIndicator paneId="pane" />));
    const details = host.querySelector("details")!;
    details.open = true;
    await act(async () => host.querySelector(".usage-details")!.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true})));
    expect(details.open).toBe(true);
    await act(async () => outside.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true})));
    expect(details.open).toBe(false);
    details.open = true;
    await act(async () => outside.focus());
    expect(details.open).toBe(false);
    details.open = true;
    const summary = details.querySelector("summary")!;
    summary.tabIndex = 0; summary.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})));
    expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
    details.open = true;
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    await act(async () => dialog.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true})));
    expect(details.open).toBe(true);
    expect(host.querySelector('[role="dialog"]')).toBe(dialog);
  } finally { await act(async () => root.unmount()); }
});
it("portals mobile usage outside the pane, adapts to the visible viewport and keeps dismissal/reset confirmation working", async () => {
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  const viewport = Object.assign(new EventTarget(), {width: 390, height: 844, offsetLeft: 0, offsetTop: 0});
  vi.stubGlobal("visualViewport", viewport);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(quota()))); vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<UsageIndicator paneId="pane" />));
    const details = host.querySelector("details")!;
    await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    const panel = document.body.querySelector<HTMLDivElement>(".usage-details-mobile")!;
    expect(panel).not.toBeNull(); expect(panel.parentElement).toBe(document.body); expect(host.contains(panel)).toBe(false);
    expect(panel.style.width).toBe("360px"); expect(panel.style.left).toBe("15px");
    viewport.height = 280; viewport.offsetTop = 90;
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    expect(panel.style.bottom).toBe("486px"); expect(panel.style.maxHeight).toBe("196px");
    await act(async () => panel.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true})));
    expect(details.open).toBe(true);
    await act(async () => [...panel.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull(); expect(host.contains(dialog)).toBe(false);
    await act(async () => [...dialog.querySelectorAll("button")].find(b => b.textContent === "Cancel")!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true})));
    expect(details.open).toBe(false); expect(document.body.querySelector(".usage-details-mobile")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});
it("shows credits and reset expiry, confirms before using one, and displays provider-refreshed limits", async () => {
  const initial = quota();
  const refreshed = {...initial, observedAt: initial.observedAt! + 1, bankedResets: {availableCount: 0, credits: []},
    windows: [{...initial.windows[0], remaining: 100}]};
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ?
    {outcome: "reset", quota: refreshed} : initial)));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<UsageIndicator paneId="pane" />));
    expect(host.textContent).toContain("150.5 remaining"); expect(host.textContent).toContain("Expires");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("account@example.test"); expect(dialog.textContent).toContain("cannot be undone");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
    await act(async () => [...dialog.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    const calls = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({pane: "pane", creditId: "one", accountKey: initial.accountKey, availableCount: 1});
    expect(host.textContent).toContain("Banked reset applied."); expect(host.textContent).toContain("Weekly 100%");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("retries an uncertain reset with the same nonce and never retries automatically", async () => {
  vi.useFakeTimers(); const initial = quota(); let requests = 0;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST" ?
    ++requests === 1 ? new Response(JSON.stringify({error: "Reset result is unknown."}), {status: 502}) :
      new Response(JSON.stringify({outcome: "alreadyRedeemed"})) : new Response(JSON.stringify(initial)));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<UsageIndicator paneId="pane" />));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    await act(async () => [...host.querySelector('[role="dialog"]')!.querySelectorAll("button")].find(b => b.textContent === "Use reset")!.click());
    expect(host.textContent).toContain("Retry the same reset attempt?");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Reset result is unknown.");
    initial.bankedResets = {availableCount: 0, credits: []};
    initial.observedAt = Date.now() / 1000 + 1;
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(requests).toBe(1);
    await act(async () => [...host.querySelector('[role="dialog"]')!.querySelectorAll("button")].find(b => b.textContent === "Retry same attempt")!.click());
    const calls = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(JSON.parse(calls[0][1]!.body as string).requestId).toBe(JSON.parse(calls[1][1]!.body as string).requestId);
    expect(host.textContent).toContain("This reset was already applied.");
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});

it("handles count-only resets and sends no redemption for Claude or unknown account identity", async () => {
  let value: Quota = {...quota(), bankedResets: {availableCount: 2, credits: null}};
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(value))));
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<UsageIndicator paneId="pane" />));
    expect(host.textContent).toContain("Individual details are not available");
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Use next available reset")?.disabled).toBe(false);
    value = {...value, accountKey: null};
    await act(async () => root.render(<UsageIndicator key="other" paneId="other" />));
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Use next available reset")?.disabled).toBe(true);
    value = {provider: "claude", status: "ok", windows: []};
    await act(async () => root.render(<UsageIndicator key="claude" paneId="claude" />));
    expect(host.textContent).toContain("Credit balance not reported by Claude Code");
    expect(host.querySelector('a[href="https://claude.ai/settings/usage"]')).not.toBeNull();
    expect(host.textContent).not.toContain("0 available");
  } finally { await act(async () => root.unmount()); }
});
