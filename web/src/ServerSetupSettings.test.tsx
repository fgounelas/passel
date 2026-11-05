/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentCliSetupPanel, ProjectSetupPanel, TerminalStartupSetting } from "./ServerSetupSettings";

let root: Root | undefined;
const httpUrl = (path: string) => `https://server.test${path}`;
const status = (installed = false) => ({ startup_path: "~/work", projects: [
  { id: "danus", path: "~/work/danus", status: installed ? "installed" : "missing" },
  { id: "pharos", path: "~/work/pharos", status: "installed" },
] });
const response = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  document.body.innerHTML = ""; vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function render(element: React.ReactNode) {
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

it("checks projects without installing, then clones only the explicitly selected missing project", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(status()))
    .mockResolvedValueOnce(response({ id: "danus", status: "installed" }))
    .mockResolvedValueOnce(response(status(true)));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<ProjectSetupPanel httpUrl={httpUrl} serverLabel="Research server" />);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("https://server.test/api/project-files/setup");
  const buttons = [...container.querySelectorAll("button")];
  const danus = buttons.find(b => b.textContent === "Install Danus")!;
  const pharos = buttons.find(b => b.textContent === "Install Pharos")!;
  expect(danus.disabled).toBe(false); expect(pharos.disabled).toBe(true);
  await act(async () => danus.click());
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST", headers: { "X-Herdr-Setup": "1" }, body: JSON.stringify({ project: "danus" }) });
  expect(container.textContent).not.toContain("Not installed");
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "Install Danus")!.disabled).toBe(true);
});

it("keeps folders with existing files unavailable for installation and offers an explicit recheck", async () => {
  const data = status(); data.projects[0].status = "existing";
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(data)));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<ProjectSetupPanel httpUrl={httpUrl} />);
  expect([...container.querySelectorAll("button")].find(b => b.textContent === "Install Danus")!.disabled).toBe(true);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Check Danus installation"]')!.click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(call => call[1]?.method !== "POST")).toBe(true);
});

it("persists the new-session directory on blur and reports invalid server directories", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(status()))
    .mockResolvedValueOnce(response({ startup_path: "~/work/danus" }))
    .mockResolvedValueOnce(response({ error: "That directory does not exist on this server." }, 400));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<TerminalStartupSetting httpUrl={httpUrl} />);
  const input = container.querySelector("input")!;
  expect(input.value).toBe("~/work");
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(input, "~/work/danus"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ startup_path: "~/work/danus" }));
  expect(container.textContent).toContain("Saved");
  await act(async () => { set.call(input, "~/missing"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("does not exist");
  expect(input.value).toBe("~/missing");
});

it("keeps the startup field disabled until the saved server preference is loaded", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<TerminalStartupSetting httpUrl={httpUrl} />);
  const input = container.querySelector("input")!;
  expect(input.disabled).toBe(true);
  await act(async () => finish(response({ ...status(), startup_path: "~/work/pharos" })));
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("~/work/pharos");
  expect(fetch).toHaveBeenCalledTimes(1);
});

const cliStatus = (installed = false, operation: "install" | null = null) => ({ clis: [
  { id: "claude", installed: true, version: "2.1.0", operation: null, error: null },
  { id: "codex", installed, version: installed ? "1.2.3" : null, operation, error: null },
  { id: "agy", installed: false, version: null, operation: null, error: null },
] });

it("checks CLI versions without installing and offers the correct install/update action", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(cliStatus()))
    .mockResolvedValueOnce(response({ id: "codex", version: "1.2.3" }))
    .mockResolvedValueOnce(response(cliStatus(true)));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<AgentCliSetupPanel httpUrl={httpUrl} serverLabel="Research server" />);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("https://server.test/api/project-files/setup/clis");
  expect(container.textContent).toContain("Installed · 2.1.0");
  expect(container.textContent).toContain("Update Claude Code");
  expect(container.textContent).toContain("Install agy");
  const install = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Install Codex"))!;
  await act(async () => install.click());
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST", headers: { "X-Herdr-Setup": "1" },
    body: JSON.stringify({ cli: "codex", action: "install" }) });
  expect(container.textContent).toContain("Update Codex");
  expect(container.textContent).toContain("Installed · 1.2.3");
});

it("disables duplicate CLI operations while updating and shows server failures", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn().mockResolvedValueOnce(response(cliStatus(true)))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<AgentCliSetupPanel httpUrl={httpUrl} />);
  const update = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Update Codex"))!;
  await act(async () => update.click());
  expect(fetch.mock.calls[1][1].body).toBe(JSON.stringify({ cli: "codex", action: "update" }));
  expect(container.textContent).toContain("Updating…");
  expect([...container.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => finish(response({ error: "Download failed. Please retry." }, 502)));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Download failed");
  expect(update.disabled).toBe(false);
});

it("refreshes an installation started by another browser until it finishes", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(response(cliStatus(false, "install")))
    .mockResolvedValueOnce(response(cliStatus(true)));
  vi.stubGlobal("fetch", fetch);
  const container = await render(<AgentCliSetupPanel httpUrl={httpUrl} />);
  expect(container.textContent).toContain("Installing…");
  expect([...container.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(call => call[1]?.method !== "POST")).toBe(true);
  expect(container.textContent).toContain("Installed · 1.2.3");
  expect([...container.querySelectorAll("button")].some(button => !button.disabled)).toBe(true);
});

it("keeps CLI installation unavailable until a valid server response arrives", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ clis: [{ id: "unknown" }] })));
  const container = await render(<AgentCliSetupPanel httpUrl={httpUrl} />);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid CLI setup information");
  expect([...container.querySelectorAll("button")].filter(button => button.textContent?.includes("Install"))
    .every(button => button.disabled)).toBe(true);
});
