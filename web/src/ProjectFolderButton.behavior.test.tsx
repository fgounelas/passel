/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectFolderButton } from "./ProjectFolderButton";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; localStorage.clear(); });

it("selects the last of many projects, remembers across pane remounts and allows changing the choice", async () => {
  const names = Array.from({length: 120}, (_, i) => `project-${i}`);
  const fetcher = vi.fn(async (url: string) => {
    const parsed = new URL(url, "https://test");
    return new Response(JSON.stringify(url.includes("conversation?") ? {status: "ok", messages: []} :
      {entries: (parsed.searchParams.get("path") === "" ? ["danus"] : names).map(name => ({name, directory: true}))}));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const onOpen = vi.fn();
  const render = (paneId: string) => <ProjectFolderButton bridgeId="primary" terminalId="stable-example-terminal" paneId={paneId}
    cwd="/home/example/work/danus" enabled onOpen={onOpen} />;
  try {
    await act(async () => root.render(render("old-pane")));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Files"]')!.click());
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(120);
    await act(async () => host.querySelector('[role="menuitem"]')!.dispatchEvent(new KeyboardEvent("keydown", {key: "End", bubbles: true})));
    expect(document.activeElement?.textContent).toBe("danus/runtime/projects/project-119");
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenLastCalledWith("danus/runtime/projects/project-119");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await act(async () => root.render(null));
    await act(async () => root.render(render("renumbered-pane")));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Files"]')!.click());
    expect(onOpen).toHaveBeenLastCalledWith("danus/runtime/projects/project-119");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => url.includes("conversation?"))).toHaveLength(1);
    await act(async () => host.querySelector('[aria-label="Open Files"]')!.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true})));
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(120);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open Files"]')!.click());
    expect(onOpen).toHaveBeenLastCalledWith("danus/runtime/projects/project-0");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("ignores late lookup results after leaving the pane", async () => {
  let finish!: (response: Response) => void; let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (url.includes("conversation?")) { signal = options?.signal as AbortSignal; return new Promise<Response>(resolve => { finish = resolve; }); }
    const names = new URL(url, "https://test").searchParams.get("path") === "" ? ["danus"] : ["example", "other"];
    return Promise.resolve(new Response(JSON.stringify({entries: names.map(name => ({name, directory: true}))})));
  }));
  const host = document.createElement("div"); const root = createRoot(host); const onOpen = vi.fn();
  try {
    await act(async () => root.render(<ProjectFolderButton bridgeId="primary" paneId="example" terminalId="example"
      cwd="/home/example/work/danus" enabled onOpen={onOpen} />));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(signal?.aborted).toBe(false);
    await act(async () => root.render(<ProjectFolderButton bridgeId="primary" paneId="other" terminalId="other"
      cwd="/home/example/work/danus" enabled onOpen={onOpen} />));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(new Response(JSON.stringify({status: "ok", messages: []}))));
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
