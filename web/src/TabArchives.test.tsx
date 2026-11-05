// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { archiveRequest, TabArchivesProvider, useTabArchives } from "./TabArchives";

afterEach(() => vi.unstubAllGlobals());
it("validates bounded responses and sends only the chosen action and tab", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok: true, json: async () => ({tabs: ["w1:t1"], stopped: []})});
  vi.stubGlobal("fetch", fetcher);
  expect((await archiveRequest("quit", "w1:t1")).tabs.has("w1:t1")).toBe(true);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({action: "quit", tab: "w1:t1"});
  fetcher.mockResolvedValue({ok: true, json: async () => ({tabs: Array(1001).fill("a"), stopped: []})});
  await expect(archiveRequest("list")).rejects.toThrow("Invalid archive");
  fetcher.mockResolvedValue({ok: false, json: async () => ({error: "Codex has not exited"})});
  await expect(archiveRequest("quit", "w1:t1")).rejects.toThrow("Codex has not exited");
});

it("does not let an older poll undo a successful archive mutation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolvePoll!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => {resolvePoll = resolve;}))
    .mockResolvedValue({ok: true, json: async () => ({tabs: ["w1:t1"], stopped: []})});
  vi.stubGlobal("fetch", fetcher);
  let controls!: ReturnType<typeof useTabArchives>;
  function Consumer() {controls = useTabArchives(); return <span>{[...controls.tabs].join(",")}</span>;}
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<TabArchivesProvider enabled><Consumer /></TabArchivesProvider>));
    await act(async () => controls.change("w1:t1", "archive"));
    await act(async () => resolvePoll({ok: true, json: async () => ({tabs: [], stopped: []})}));
    expect(host.textContent).toBe("w1:t1");
  } finally {await act(async () => root.unmount()); host.remove();}
});

it("explains a non-JSON proxy response without repeating the archive action", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:false, status:502,
    json:async()=>{throw new SyntaxError("Unexpected token <");}});
  vi.stubGlobal("fetch",fetcher);
  await expect(archiveRequest("archive","w1:t1")).rejects.toThrow("Check Current and Archived");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
