/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationFileContext, ConversationFileLink } from "./ConversationFileLink";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function fileLink(href: string, extension = "pdf", roots = ["pharos"]) {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: navigator.userAgent });
  const fetcher = vi.fn(async (url: string) => {
    const path = new URL(url, window.location.href).searchParams.get("path");
    return new Response(JSON.stringify({ entries: path === ""
      ? roots.map(name => ({ name, directory: true })) : [{ name: `main.${extension}`, directory: false }] }));
  });
  vi.stubGlobal("fetch", fetcher);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const open = vi.fn();
  await act(async () => root.render(<ConversationFileContext.Provider value={open}>
    <ConversationFileLink href={href}>Paper</ConversationFileLink>
  </ConversationFileContext.Provider>));
  const copy = async () => {
    await act(async () => host.querySelector("a")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const button = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent === "Copy link");
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  };
  return { host, open, writeText, fetcher, copy, cleanup: () => act(async () => root.unmount()) };
}

it.each(["pdf", "tex", "md"])("copies the resolved %s file URL without opening or downloading it", async extension => {
  const file = `pharos/runtime/projects/sample-project/papers/main.${extension}`;
  const link = await fileLink(file, extension);
  try {
    await link.copy();
    expect(link.writeText).toHaveBeenCalledOnce();
    const url = new URL(link.writeText.mock.calls[0][0]);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/project-files/content");
    expect([...url.searchParams]).toEqual([["root", "work"], ["path", file]]);
    expect(link.open).not.toHaveBeenCalled();
    expect(link.fetcher.mock.calls.every(([url]) => url.includes("/list?"))).toBe(true);
    expect(link.host.textContent).toContain("Link copied.");
    expect(link.host.querySelector('[role="menu"]')).toBeNull();
  } finally { await link.cleanup(); }
});

it("asks which workspace to copy when a relative file reference is ambiguous", async () => {
  const link = await fileLink("runtime/projects/sample-project/papers/main.pdf", "pdf", ["danus", "pharos"]);
  try {
    await link.copy();
    expect(link.writeText).not.toHaveBeenCalled();
    expect(link.host.textContent).toContain("Copy link from:");
    await act(async () => [...link.host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "pharos")!.click());
    expect(new URL(link.writeText.mock.calls[0][0]).searchParams.get("path")).toBe("pharos/runtime/projects/sample-project/papers/main.pdf");
    expect(link.open).not.toHaveBeenCalled();
  } finally { await link.cleanup(); }
});

it("reports clipboard failure without claiming success or opening the file", async () => {
  const link = await fileLink("pharos/runtime/projects/sample-project/papers/main.pdf");
  link.writeText.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  try {
    await link.copy();
    expect(link.host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy the link");
    expect(link.host.textContent).not.toContain("Link copied.");
    expect(link.open).not.toHaveBeenCalled();
  } finally { await link.cleanup(); }
});
