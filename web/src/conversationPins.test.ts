import { afterEach, expect, it, vi } from "vitest";
import { loadConversationPins, saveConversationPin } from "./conversationPins";

afterEach(() => vi.unstubAllGlobals());
it("saves server-side by session and message ID without uploading browser text or filesystem paths", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({status: "saved"})));
  vi.stubGlobal("fetch", fetcher);
  await saveConversationPin("w3:p1", "session", "100", true);
  const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/project-files/conversation/bookmarks");
  expect(options.credentials).toBe("same-origin");
  expect(JSON.parse(options.body as string)).toEqual({action: "add", pane: "w3:p1", session: "session", message: "100"});
});

it("reads persisted bookmarks independently of a live pane and removes idempotently", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({pins: [], ids: [], hasMore: false, nextOffset: 0})));
  vi.stubGlobal("fetch", fetcher);
  await loadConversationPins("saved-session");
  await saveConversationPin("unattached", "saved-session", "100", false);
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(JSON.parse(calls[0][1].body as string)).toEqual({action: "list", session: "saved-session", offset: 0});
  expect(JSON.parse(calls[1][1].body as string)).toEqual({action: "remove", session: "saved-session", message: "100"});
});

it("reports server failures and rejects unbounded pages", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({error: "Storage full"}), {status: 409})));
  await expect(saveConversationPin("pane", "session", "1", true)).rejects.toThrow("Storage full");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({pins: Array.from({length: 101}, () => ({text: "x"})), ids: []}))));
  await expect(loadConversationPins("session")).rejects.toThrow("Invalid bookmarks response");
});
