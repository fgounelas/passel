// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationView as View } from "./ConversationView";
import { CommandDraftContext, createCommandDraftStore } from "./commandDrafts";
import { loadConversationPins, saveConversationPin, type ConversationPin } from "./conversationPins";
vi.mock("./conversationPins", async importOriginal => ({
  ...await importOriginal<typeof import("./conversationPins")>(),
  loadConversationPins: vi.fn(), saveConversationPin: vi.fn(),
}));
beforeEach(() => {
  // Give the scroller a real extent: jsdom otherwise reports every view at both ends.
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000);
  let saved: ConversationPin[] = [];
  vi.mocked(loadConversationPins).mockImplementation(async session => ({pins: saved.filter(p => p.session === session),
    ids: saved.filter(p => p.session === session).map(p => p.id), hasMore: false, nextOffset: saved.length}));
  vi.mocked(saveConversationPin).mockImplementation(async (_pane, session, id, add) => {
    if (add) saved.push({session, id, role: id === "11" ? "user" : "assistant", text: id === "11" ? "What is known?" : "The bound is 2."});
    else saved = saved.filter(p => p.session !== session || p.id !== id);
  });
});
function ConversationView(props: {paneId: string}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  return <CommandDraftContext.Provider value={createCommandDraftStore()}>
    <button aria-label="Search conversation" onClick={() => setSearchOpen(value => !value)}>Search icon</button>
    <View {...props} bridgeId="primary" searchOpen={searchOpen} onCloseSearch={() => setSearchOpen(false)} pinsOpen={pinsOpen} onPinsOpenChange={setPinsOpen} />
  </CommandDraftContext.Provider>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("renders complete assistant updates and maths, blocks active content, without redundant toolbar", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const text = "The sample configuration is now under verification. It is not yet an accepted result.\n\n\\(h_n=1\\)\n\n<script>bad()</script>\n\n![tracker](https://tracker.test/image)";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one",
    messages: [{id: "1", role: "assistant", text}, {id: "2", role: "user", text: "Please explain."}]}))));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<ConversationView paneId="w6:p1" />); });
    expect(host.textContent).toContain("It is not yet an accepted result.");
    expect(host.textContent).toContain("Please explain.");
    expect(host.querySelector(".katex")).not.toBeNull();
    expect(host.querySelector("script, img")).toBeNull();
    expect(host.textContent).not.toContain("Open Terminal");
    expect(host.textContent).not.toContain("updates automatically");
    expect(host.querySelector(".conversation-start")?.getAttribute("aria-label")).toBe("Go to top");
    expect(host.querySelector(".conversation-start")?.textContent).toBe("");
    const node = host.querySelector<HTMLDivElement>(".conversation-scroll")!;
    node.scrollTop = 0;
    await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
    expect(host.querySelector(".conversation-previous")).toBeNull();
    node.scrollTop = 200;
    await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
    expect(host.querySelector(".conversation-previous")).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("bounds initial rendering and expands history on demand", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("direction=after") ?
    {messages: [{id: "179", role: "assistant", text: "Update 79"}, {id: "180", role: "assistant", text: "Newest answer"}], before: 179, after: 200, hasEarlier: true, hasLater: false} : url.includes("/history?") ?
    {messages: [{id: "20", role: "assistant", text: "Older saved answer"}], before: 20, after: 100, hasEarlier: false, hasLater: true} :
    {status: "ok", session: "one", earlier: true,
      messages: Array.from({length: 80}, (_, i) => ({id: String(100 + i), role: "assistant", text: `Update ${i}`}))})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    expect(host.querySelectorAll("article")).toHaveLength(40);
    const scroller = host.querySelector(".conversation-scroll") as HTMLDivElement;
    scroller.scrollTop = 0;
    await act(async () => { scroller.dispatchEvent(new Event("scroll", {bubbles: true})); });
    expect(host.querySelectorAll("article")).toHaveLength(80);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Load earlier messages");
    expect(host.textContent).not.toContain("Load newer messages");
    expect(host.textContent).not.toContain("Show earlier messages");
    expect(host.textContent).not.toContain("Load older history");
    Object.defineProperty(scroller, "scrollHeight", {get: () => host.querySelectorAll("article").length * 100});
    scroller.scrollTop = 0;
    await act(async () => { scroller.dispatchEvent(new Event("scroll", {bubbles: true})); });
    expect(scroller.scrollTop).toBe(0);
    expect(host.textContent).toContain("Older saved answer");
    expect(host.textContent).toContain("Update 78");
    expect(host.querySelectorAll("article")).toHaveLength(80);
    expect(fetcher.mock.calls[1][0]).toContain("direction=before&cursor=100");
    Object.defineProperty(scroller, "clientHeight", {value: 1000});
    scroller.scrollTop = 7000;
    await act(async () => { scroller.dispatchEvent(new Event("scroll", {bubbles: true})); });
    expect(host.querySelectorAll("article")).toHaveLength(80);
    expect(host.textContent).toContain("Newest answer");
    expect(host.textContent).not.toContain("Older saved answer");
    expect(scroller.scrollTop).toBe(7000);
  } finally { await act(async () => root.unmount()); }
});

it("sends the draft to the displayed session, preserves multiline text and never attaches a terminal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "w6:p1", "Explain the bound.\nIs it verified?");
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? {status: "sent"} :
    {status: "ok", session: "12345678-1234-1234-1234-123456789012", messages: []})));
  vi.stubGlobal("fetch", fetcher);
  const websocket = vi.fn(); vi.stubGlobal("WebSocket", websocket);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="w6:p1" bridgeId="primary" /></CommandDraftContext.Provider>));
    await act(async () => { host.querySelector(".conversation-composer")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
    const call = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({pane: "w6:p1", session: "12345678-1234-1234-1234-123456789012", text: "Explain the bound.\nIs it verified?"});
    expect(store.get("primary", "w6:p1")).toBe("");
    expect(host.textContent).toContain("Input submitted");
    expect(websocket).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});

it("keeps a rejected reply as a draft and does not retry it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "pane", "My reply");
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST" ?
    new Response(JSON.stringify({error: "The conversation changed."}), {status: 409}) :
    new Response(JSON.stringify({status: "ok", session: "session", messages: []})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    await act(async () => { host.querySelector(".conversation-composer")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
    expect(store.get("primary", "pane")).toBe("My reply");
    expect(host.textContent).toContain("The conversation changed.");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  } finally { await act(async () => root.unmount()); }
});

it("enables the first reply before Codex has created a transcript", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "new-pane", "First question");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "process-token", awaitingFirstMessage: true, messages: []}))));
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="new-pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    expect(host.textContent).toContain("The agent is connected.");
    expect(host.textContent).not.toContain("No supported conversation");
    expect((host.querySelector('.conversation-composer button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  } finally { await act(async () => root.unmount()); }
});

it.each(["plain", "claude-paste"])("reconciles %s acknowledgements after marking unconfirmed input, without retrying", async format => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const store = createCommandDraftStore(); store.set("primary", "pane", "How does the new theorem work?");
  let acknowledged = false;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ?
    {status: "sent"} : {status: "ok", session: "one", messages: acknowledged ?
      [{id: "2", role: "user", text: format === "plain" ? "How does the new theorem work?" :
        '\n\n<pasted_content id="a5b6">\nHow does the new theorem work?\n</pasted_content id="a5b6">\n'}] : []})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    await act(async () => host.querySelector(".conversation-composer")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("Input submitted · awaiting the agent");
    expect(host.querySelector(".conversation-pending-actions")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("Not yet confirmed · check Terminal");
    await act(async () => store.set("primary", "pane", "An existing draft."));
    expect(host.querySelector('[data-pending="true"] button')).toBeNull();
    expect(store.get("primary", "pane")).toBe("An existing draft.");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    // A legitimately queued message can still arrive; clear the temporary copy.
    acknowledged = true;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(host.querySelector('[data-pending="true"]')).toBeNull();
    expect(host.querySelector('article[data-message-id="2"]')?.textContent).toContain("How does the new theorem work?");
    expect(host.querySelector('article[data-message-id="2"] pasted_content')).toBeNull();
    expect(store.get("primary", "pane")).toBe("An existing draft.");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});

it("keeps the unconfirmed copy without dismissal or recovery actions, leaving the draft untouched", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "pane", "My new draft");
  store.updateOutgoing("primary", "pane", () => [{id: "pending", text: "Unacknowledged question", session: "one", first: false, sent: true, knownIds: []}]);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one", messages: []})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("Not yet confirmed");
    expect(host.querySelector('[data-pending="true"] button')).toBeNull();
    expect(host.textContent).not.toContain("Dismiss copy");
    expect(host.textContent).not.toContain("Copy to reply");
    expect(store.getOutgoing("primary", "pane")).toHaveLength(1);
    expect(store.get("primary", "pane")).toBe("My new draft");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});

it("requires an explicit input acknowledgement and preserves the draft for ambiguous success responses", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "pane", "My question");
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? {} :
    {status: "ok", session: "one", messages: []})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    await act(async () => host.querySelector(".conversation-composer")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
    expect(store.get("primary", "pane")).toBe("My question");
    expect(host.textContent).toContain("Delivery could not be confirmed. Check Terminal before resending.");
    expect(host.querySelector('[data-pending="true"]')).toBeNull();
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  } finally { await act(async () => root.unmount()); }
});

it("loads the original beginning independently of the recent message cache", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/history?') ?
    {messages: [{id: "20", role: "user", text: "Original research question"}], before: 20, after: 120, hasEarlier: false, hasLater: true} :
    {status: "ok", session: "session", earlier: true, messages: [{id: "9999", role: "assistant", text: "Latest update"}]})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    await act(async () => { host.querySelector<HTMLButtonElement>(".conversation-start")!.click(); });
    expect(host.textContent).toContain("Original research question");
    expect(host.textContent).not.toContain("Latest update");
    expect(fetcher.mock.calls.some(([url]) => url.includes('direction=start'))).toBe(true);
    expect(host.querySelector(".conversation-start")).toBeNull();
    expect(host.querySelector(".conversation-previous")).toBeNull();
    expect(host.querySelector(".conversation-latest")?.getAttribute("aria-label")).toBe("Go to bottom");
    expect(host.querySelector(".conversation-latest")?.textContent).toBe("");
    expect(host.querySelector(".conversation-history-controls")).toBeNull();
    expect(host.textContent).not.toContain("Load earlier messages");
    expect(host.textContent).not.toContain("Load newer messages");
    const node = host.querySelector<HTMLDivElement>(".conversation-scroll")!;
    Object.defineProperties(node, {scrollHeight: {value: 2000}, clientHeight: {value: 500}});
    node.scrollTop = 200;
    await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
    expect(host.querySelector(".conversation-previous")).not.toBeNull();
    expect(host.querySelector(".conversation-start")).not.toBeNull();
    node.scrollTop = 0;
    await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
    expect(host.querySelector(".conversation-previous")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>(".conversation-latest")!.click(); });
    expect(host.textContent).toContain("Latest update");
  } finally { await act(async () => root.unmount()); }
});

it("searches saved message pages without exposing tool output", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('direction=search') ?
    {messages: [{id: "20", role: "assistant", text: "The sample configuration is under verification."}], before: 20, after: 120, nextCursor: 120, hasEarlier: false, hasLater: false} :
    {status: "ok", session: "session", messages: [{id: "9999", role: "assistant", text: "Latest update"}]})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    expect(host.querySelector('input[type="search"]')).toBeNull();
    await act(async () => { (host.querySelector('button[aria-label="Search conversation"]') as HTMLButtonElement).click(); });
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(host.querySelector(".conversation-start")).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sample");
      input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    await act(async () => host.querySelector('.conversation-search')!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
    expect(host.textContent).toContain("The sample configuration is under verification.");
    expect(host.textContent).toContain("1 matching messages");
    expect(host.querySelector("mark.conversation-search-match")?.textContent).toBe("sample");
    expect(fetcher.mock.calls.some(([url]) => url.includes('query=sample'))).toBe(true);
    const clear = host.querySelector<HTMLButtonElement>('.conversation-search-field button[aria-label="Clear search"]')!;
    expect(clear.textContent).toBe("");
    expect(clear.querySelector("svg")).not.toBeNull();
    expect(clear.parentElement).toBe(input.parentElement);
    await act(async () => { clear.click(); });
    expect(host.querySelector('input[type="search"]')).toBe(input);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(host.querySelector("mark.conversation-search-match")).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Search conversation"]')!.click(); });
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(host.textContent).toContain('Latest update');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("cancels pending history and polling when the pane is unmounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let historySignal: AbortSignal | undefined;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (url.includes("/history?")) {
      historySignal = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => historySignal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true}));
    }
    return Promise.resolve(new Response(JSON.stringify({status: "ok", session: "session", earlier: true,
      messages: [{id: "100", role: "assistant", text: "Latest"}]})));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    await act(async () => { host.querySelector<HTMLButtonElement>(".conversation-start")!.click(); });
    expect(historySignal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(historySignal?.aborted).toBe(true);
    const calls = fetcher.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(calls);
  } finally { vi.useRealTimers(); }
});

it("shows a reply before delivery completes and reconciles it with a new transcript message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "pane", "Explain this");
  let completeSend!: (response: Response) => void;
  let saved = false;
  const fetcher = vi.fn((_url: string, options?: RequestInit) => options?.method === "POST" ?
    new Promise<Response>(resolve => { completeSend = resolve; }) : Promise.resolve(new Response(JSON.stringify({status: "ok", session: "session",
      messages: [{id: "1", role: "user", text: "Explain this"}, ...(saved ? [{id: "2", role: "user", text: "Explain this"}] : [])]}))));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    await act(async () => { host.querySelector(".conversation-composer")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})); });
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("Sending…Explain this");
    expect(host.querySelectorAll("article")).toHaveLength(2);
    // Switching to Terminal unmounts Conversation; delivery can finish there.
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><div>Terminal</div></CommandDraftContext.Provider>));
    store.set("primary", "pane", "A new terminal draft");
    await act(async () => completeSend(new Response(JSON.stringify({status: "sent"}))));
    expect(store.get("primary", "pane")).toBe("A new terminal draft");
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("awaiting the agent");
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><div>Terminal</div></CommandDraftContext.Provider>));
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    expect(host.querySelector('[data-pending="true"]')?.textContent).toContain("Explain this");
    saved = true;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.querySelector('[data-pending="true"]')).toBeNull();
    expect(host.querySelectorAll("article")).toHaveLength(2);
  } finally { await act(async () => root.unmount()); }
});

it("shows a bounded activity slot only for an actively working pane, with no extra polling", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({status: 'ok', session: 'session',
    activity: {id: 'call', command: 'ls plans', output: 'audit.md'}, turnActive: true,
    messages: [{id: '1', role: 'assistant', text: 'Progress update'}]})));
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div'); const root = createRoot(host);
  const store = createCommandDraftStore();
  try {
    const render = async (agentStatus: 'working' | 'idle' | 'blocked' | 'done' | 'unknown') => {
      await act(async () => root.render(<CommandDraftContext.Provider value={store}>
        <View paneId="pane" bridgeId="primary" agentStatus={agentStatus} />
      </CommandDraftContext.Provider>));
    };
    await render('working');
    expect(host.querySelector('.conversation-activity')?.textContent).toContain('ls plans');
    expect(host.querySelector('.conversation-activity')?.textContent).toContain('audit.md');
    expect(host.querySelector('.conversation-content > .conversation-activity')).not.toBeNull();
    for (const status of ['idle', 'blocked', 'done', 'unknown'] as const) {
      await render(status);
      expect(host.querySelector('.conversation-activity')).toBeNull();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});

it("retains messages during brief discovery gaps, blocks sending and expires prolonged gaps", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const store = createCommandDraftStore(); store.set('primary', 'pane', 'My draft');
  let available = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(available ?
    {status: 'ok', session: 'session', messages: [{id: '100', role: 'assistant', text: 'Research result'}]} :
    {status: 'unavailable', messages: []}))));
  const host = document.createElement('div'); const root = createRoot(host);
  const refresh = async () => { await act(async () => { window.dispatchEvent(new Event('focus')); }); };
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    const send = () => host.querySelector<HTMLButtonElement>('.conversation-composer button[type="submit"]')!;
    expect(send().disabled).toBe(false);
    available = false; await refresh();
    expect(host.textContent).toContain('Research result');
    expect(host.textContent).not.toContain('No supported conversation');
    expect(send().disabled).toBe(true);
    available = true; await refresh();
    expect(host.textContent).toContain('Research result');
    expect(send().disabled).toBe(false);
    available = false; await refresh();
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(host.textContent).not.toContain('Research result');
    expect(host.textContent).toContain('No supported conversation');
    expect(store.get('primary', 'pane')).toBe('My draft');
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});

it("opens plain and Markdown file links in the viewer without fetching document contents", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { ConversationFileContext } = await import("./ConversationFileLink");
  const open = vi.fn();
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/list?") ? {
    entries: new URL(url, "https://test").searchParams.get("path") === "" ? [{name: "danus-mine", directory: true}] : [{name: "audit.md", directory: false}],
  } : {status: "ok", session: "one", messages: [{id: "1", role: "assistant", text:
    "Saved (runtime/projects/p/plans/audit.md). [Audit](file:///home/example/work/danus-mine/runtime/projects/p/plans/audit.md). [External](https://example.com)."}]})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationFileContext.Provider value={open}><ConversationView paneId="pane" /></ConversationFileContext.Provider>));
    const links = host.querySelectorAll("a");
    expect(links).toHaveLength(3);
    await act(async () => links[0].click());
    expect(open).toHaveBeenLastCalledWith("danus-mine/runtime/projects/p/plans/audit.md");
    await act(async () => links[1].click());
    expect(open).toHaveBeenCalledTimes(2);
    expect(links[2].target).toBe("_blank");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/content?"))).toBe(false);
  } finally { await act(async () => root.unmount()); }
});

it("offers Reveal in Files from the file-link context menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { ConversationFileContext } = await import("./ConversationFileLink");
  const open = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/list?") ?
    {entries: [{name: "audit.md", directory: false}]} : {status: "ok", session: "one", messages: [
      {id: "1", role: "assistant", text: "[Audit](danus/runtime/projects/p/plans/audit.md)"}]}))));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationFileContext.Provider value={open}><ConversationView paneId="pane" /></ConversationFileContext.Provider>));
    await act(async () => host.querySelector("a")!.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true})));
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent === "Reveal in Files");
    expect(item).toBeTruthy();
    await act(async () => item!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("danus/runtime/projects/p/plans/audit.md", "reveal");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("replaces transient command output, renders it as text, and clears it on turn completion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  let activity: {id: string; command: string; output: string} | null = {id: "1", command: "first command", output: "old output"};
  let turnActive = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one", activity, turnActive,
    messages: [{id: "message", role: "assistant", text: "Retained explanation"}]}))));
  const host = document.createElement("div"); const root = createRoot(host);
  const store = createCommandDraftStore();
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" agentStatus="working" /></CommandDraftContext.Provider>));
    const slot = host.querySelector('.conversation-activity');
    expect(slot?.textContent).toContain('first command');
    activity = {id: "2", command: "next command", output: '<img src=x onerror=bad()>' + 'a'.repeat(10000)};
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(host.querySelector('.conversation-activity')).toBe(slot);
    expect(slot?.textContent).not.toContain('old output');
    expect(slot?.textContent).toContain('next command');
    expect(slot?.querySelector('img')).toBeNull();
    expect(slot?.querySelectorAll('pre')[1].textContent?.length).toBe(4001);
    expect(host.querySelectorAll('article')).toHaveLength(1);
    activity = null; turnActive = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(host.querySelector('.conversation-activity')).toBeNull();
    expect(host.textContent).toContain('Retained explanation');
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});

it("pins questions and responses from their menus, persists across remounts, and jumps to the original message", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "pins-test", messages: [
    {id: "11", role: "user", text: "What is known?"}, {id: "22", role: "assistant", text: "The bound is \\(n=2\\)."},
  ]}))));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    const articles = host.querySelectorAll("article");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(articles[0].querySelector("p")!);
    selection.removeAllRanges(); selection.addRange(range);
    const context = new MouseEvent("contextmenu", {bubbles: true, cancelable: true, clientX: 10, clientY: 10});
    await act(async () => articles[0].querySelector("p")!.dispatchEvent(context));
    expect(context.defaultPrevented).toBe(false);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(selection.toString()).toBe("What is known?");
    expect(document.activeElement).not.toBe(articles[0].querySelector('[aria-label="Message actions"]'));
    selection.removeAllRanges();
    await act(async () => articles[0].querySelector<HTMLButtonElement>('[aria-label="Message actions"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(host.querySelector('[aria-label="Pinned messages"]')?.textContent).toContain("What is known?");
    await act(async () => articles[1].querySelector<HTMLButtonElement>('[aria-label="Message actions"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(host.querySelectorAll(".conversation-pin")).toHaveLength(2);
    const previews = host.querySelectorAll<HTMLButtonElement>(".conversation-pin-preview");
    await act(async () => previews[0].click());
    await act(async () => previews[1].click());
    expect(host.querySelectorAll(".conversation-pin .conversation-message")).toHaveLength(0);
    expect(document.activeElement).toBe(articles[1]);
    expect(articles[1].getAttribute("data-jump-target")).toBe("true");
    await act(async () => root.render(<ConversationView key="remount" paneId="new-pane-id" />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Message actions"]')!.click());
    expect(host.querySelector('[role="menuitem"]')?.textContent).toBe("Unpin message");
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});

it("inserts a shortcut without sending or discarding the existing draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createCommandDraftStore(); store.set("primary", "pane", "Please be concise.");
  const fetcher = vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one", messages: []})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary" /></CommandDraftContext.Provider>));
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Message shortcuts"]')!;
    await act(async () => { select.value = "0"; select.dispatchEvent(new Event("change", {bubbles: true})); });
    expect(store.get("primary", "pane")).toBe("Please be concise.\n\nGive me a status update since I last asked.");
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("loads a pinned message outside the reading window and focuses it in its saved conversation context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadConversationPins).mockResolvedValue({pins: [{id: "42", session: "one", role: "assistant", text: "Earlier proof"}], ids: ["42"], hasMore: false, nextOffset: 1});
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/history?") ?
    {messages: [{id: "42", role: "assistant", text: "Earlier proof"}, {id: "75", role: "user", text: "A follow-up question"}], before: 42, after: 100, hasEarlier: true, hasLater: true} :
    {status: "ok", session: "one", messages: [{id: "900", role: "assistant", text: "Latest update"}]})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CommandDraftContext.Provider value={createCommandDraftStore()}><View paneId="pane" bridgeId="primary" pinsOpen /></CommandDraftContext.Provider>));
    expect(host.querySelector('article[data-message-id="42"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-pin-preview")!.click());
    expect(fetcher.mock.calls[1][0]).toContain("direction=after&cursor=42");
    const original = host.querySelector('article[data-message-id="42"]');
    expect(original?.textContent).toContain("Earlier proof");
    expect(document.activeElement).toBe(original);
    expect(host.querySelector('article[data-message-id="75"]')?.textContent).toContain("A follow-up question");
    expect(host.querySelectorAll(".conversation-pin .conversation-message")).toHaveLength(0);
    expect(host.querySelector(".conversation-latest")).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-pin-preview")!.click());
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

vi.mock("./ConversationChoice", () => ({ ConversationChoice: () => null }));

it("steps backward through user prompts one at a time and resets on Bottom", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one", messages: [
    {id: "10", role: "user", text: "First question"}, {id: "20", role: "assistant", text: "First answer"},
    {id: "30", role: "user", text: "Second question"}, {id: "40", role: "assistant", text: "Second answer"},
  ]})));
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    let previous = host.querySelector<HTMLButtonElement>(".conversation-previous")!;
    expect(previous.textContent).toBe("Previous prompt");
    expect(previous.nextElementSibling).toBe(host.querySelector(".conversation-start"));
    await act(async () => previous.click());
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("30");
    await act(async () => previous.click());
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("10");
    expect(host.querySelector(".conversation-previous")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-latest")!.click());
    previous = host.querySelector<HTMLButtonElement>(".conversation-previous")!;
    expect(previous.disabled).toBe(false);
    await act(async () => previous.click());
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("30");
    expect(host.textContent).not.toContain("Next prompt");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("finds a previous prompt through assistant-only history pages without accumulating history", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url, "https://test"); const cursor = parsed.searchParams.get("cursor");
    return new Response(JSON.stringify(url.includes("/history?") ? cursor === "100" ?
      {messages: [{id: "80", role: "assistant", text: "Earlier update"}], before: 80, after: 100, hasEarlier: true, hasLater: true} :
      {messages: [{id: "60", role: "user", text: "Earlier question"}, {id: "70", role: "assistant", text: "Its answer"}], before: 60, after: 80, hasEarlier: false, hasLater: true} :
      {status: "ok", session: "one", earlier: true, messages: [{id: "100", role: "assistant", text: "Latest result"}]}));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-previous")!.click());
    expect(fetcher.mock.calls[1][0]).toContain("direction=prompt&cursor=100");
    expect(fetcher.mock.calls[2][0]).toContain("direction=prompt&cursor=80");
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("60");
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.textContent).not.toContain("Earlier update");
    expect(host.querySelector(".conversation-previous")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps stepping across the reading window after repeated browser scroll notifications", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const messages = Array.from({length: 72}, (_, index) => ({id: String(100 + index),
    role: [13, 16, 18, 69].includes(index) ? "user" : "assistant", text: `Message ${index}`}));
  const fetcher = vi.fn(async (url: string) => {
    const cursor = Number(new URL(url, "https://test").searchParams.get("cursor"));
    const page = url.includes("direction=prompt") ? messages.filter(message => Number(message.id) < cursor).slice(-40) :
      messages.filter(message => Number(message.id) >= cursor).slice(0, 40);
    return new Response(JSON.stringify(url.includes("/history?") ?
      {messages: page, before: Number(page[0]?.id), after: Number(page.at(-1)?.id) + 1, hasEarlier: true, hasLater: true} :
      {status: "ok", session: "one", earlier: true, messages}));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    const node = host.querySelector<HTMLDivElement>(".conversation-scroll")!;
    Object.defineProperties(node, {scrollHeight: {get: () => host.querySelectorAll("article").length * 100}, clientHeight: {value: 500}});
    node.getBoundingClientRect = () => ({top: 0} as DOMRect);
    const geometry = () => {
      for (const [index, article] of [...host.querySelectorAll<HTMLElement>("article")].entries()) {
        article.getBoundingClientRect = () => ({top: 56 + index * 100 - node.scrollTop,
          bottom: 156 + index * 100 - node.scrollTop} as DOMRect);
      }
    };
    const button = host.querySelector<HTMLButtonElement>(".conversation-previous")!;
    for (const id of ["169", "118", "116", "113"]) {
      geometry();
      await act(async () => button.click());
      expect(document.activeElement?.getAttribute("data-message-id")).toBe(id);
      const calls = fetcher.mock.calls.length;
      await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
      await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
      // A jump's scroll events must not behave like scrolling into older history.
      expect(fetcher).toHaveBeenCalledTimes(calls);
    }
    expect(fetcher.mock.calls.some(([url]) => url.includes("direction=after&cursor=118"))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.includes("direction=prompt&cursor=118"))).toBe(true);
    expect(host.querySelectorAll("article").length).toBeLessThanOrEqual(80);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("cancels previous-prompt navigation on unmount without adding polling", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (url.includes("/history?")) {
      signal = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
    return Promise.resolve(new Response(JSON.stringify({status: "ok", session: "one", earlier: true, messages: [{id: "100", role: "assistant", text: "Latest result"}]})));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-previous")!.click());
    expect(signal?.aborted).toBe(false);
    expect(host.querySelector<HTMLButtonElement>(".conversation-previous")!.disabled).toBe(true);
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    const calls = fetcher.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(30000));
    expect(fetcher).toHaveBeenCalledTimes(calls);
  } finally { vi.useRealTimers(); }
});

it("uses the new reading position after a manual scroll instead of the previous jump cursor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({status: "ok", session: "one", messages: [
    {id: "10", role: "user", text: "First question"}, {id: "20", role: "assistant", text: "First answer"},
    {id: "30", role: "user", text: "Second question"}, {id: "40", role: "assistant", text: "Second answer"},
  ]}))));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    let button = host.querySelector<HTMLButtonElement>(".conversation-previous")!;
    await act(async () => button.click()); await act(async () => button.click());
    expect(host.querySelector(".conversation-previous")).toBeNull();
    const node = host.querySelector<HTMLDivElement>(".conversation-scroll")!;
    Object.defineProperties(node, {scrollHeight: {value: 800}, clientHeight: {value: 100}});
    for (const article of host.querySelectorAll<HTMLElement>("article")) article.getBoundingClientRect = () =>
      ({top: 0, bottom: article.dataset.messageId === "40" ? 90 : 0} as DOMRect);
    node.scrollTop = 100;
    await act(async () => node.dispatchEvent(new Event("scroll", {bubbles: true})));
    button = host.querySelector<HTMLButtonElement>(".conversation-previous")!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(document.activeElement?.getAttribute("data-message-id")).toBe("30");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("Top cancels an unfinished previous-prompt scan and ignores its late result", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (response: Response) => void; let signal: AbortSignal | undefined;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (url.includes("direction=prompt")) { signal = options?.signal as AbortSignal; return new Promise<Response>(resolve => {finish = resolve;}); }
    return Promise.resolve(new Response(JSON.stringify(url.includes("direction=start") ?
      {messages: [{id: "0", role: "user", text: "Original question"}], before: 0, after: 5, hasEarlier: false, hasLater: true} :
      {status: "ok", session: "one", earlier: true, messages: [{id: "100", role: "assistant", text: "Latest result"}]})));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ConversationView paneId="pane" />));
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-previous")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".conversation-start")!.click());
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(new Response(JSON.stringify({messages: [{id: "50", role: "user", text: "Stale navigation"}], before: 50, after: 60, hasEarlier: true, hasLater: true}))));
    expect(host.textContent).toContain("Original question");
    expect(host.textContent).not.toContain("Stale navigation");
  } finally { await act(async () => root.unmount()); }
});

it.each(['assistant','user'])("copies %s message text from its menu without sending, pinning or changing the draft", async role => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const text='**An explanation**\n\nThe formula is \\(H^1(X)\\).';
  const recorded=role==='user' ? `\n<pasted_content id="a5b6">\n${text}\n</pasted_content id="a5b6">\n` : text;
  const writeText=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator',{clipboard:{writeText}});
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({status:'ok',session:'one',messages:[{id:'1',role,text:recorded}]})));
  vi.stubGlobal('fetch',fetcher);
  const store=createCommandDraftStore();store.set('primary','pane','Keep this draft');
  vi.mocked(saveConversationPin).mockClear();
  const host=document.createElement('div');document.body.append(host);const app=createRoot(host);
  const open=()=>host.querySelector<HTMLButtonElement>('[aria-label="Message actions"]')!.click();
  const copy=()=>[...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b=>b.textContent==='Copy to clipboard')!.click();
  try {
    await act(async()=>app.render(<CommandDraftContext.Provider value={store}><View paneId="pane" bridgeId="primary"/></CommandDraftContext.Provider>));
    await act(async()=>open());
    expect(host.querySelector('[role="menuitem"]')?.textContent).toBe('Pin message');
    await act(async()=>copy());
    expect(writeText).toHaveBeenCalledWith(text);
    expect(host.textContent).toContain('Message copied.');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(saveConversationPin).not.toHaveBeenCalled();
    expect(store.get('primary','pane')).toBe('Keep this draft');
    expect(fetcher.mock.calls).toHaveLength(1);
    writeText.mockRejectedValueOnce(new Error('Permission denied'));
    await act(async()=>open());await act(async()=>copy());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not copy the message');
    expect(host.textContent).not.toContain('Message copied.');
  } finally {await act(async()=>app.unmount());host.remove();}
});
