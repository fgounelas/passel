// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationView as View } from "./ConversationView";
import { CommandDraftContext, createCommandDraftStore } from "./commandDrafts";
function ConversationView({paneId}: {paneId:string}) {
  return <CommandDraftContext.Provider value={createCommandDraftStore()}><View paneId={paneId} bridgeId="primary" /></CommandDraftContext.Provider>;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("shows a transient Claude login as ordinary selectable conversation text before a transcript exists", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const url = "https://claude.com/cai/oauth/authorize?client_id=test&response_type=code&state=synthetic&code_challenge=synthetic";
  let active = true;
  const fetcher = vi.fn(async (input: string) => ({ok: true, json: async () => input.includes("/choice")
    ? active ? {active:true,provider:"claude",kind:"login",loginUrl:url,token:"1:2",frame:"f",text:"Sign in"} : {active:false}
    : {status:"unavailable",messages:[]} }));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="login-test" />));
    const link = host.querySelector(".conversation-content a")!;
    expect(link.textContent).toBe(url); expect(link.getAttribute("href")).toBe(url);
    expect(host.querySelector(".conversation-choice")).toBeNull();
    expect(host.textContent).not.toContain("No supported conversation");
    expect(host.textContent).not.toContain("Copy link");
    active = false; await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(host.querySelector('[aria-label="Claude sign-in"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
