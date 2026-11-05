// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useDocumentSelection } from "./documentSelection";

function Reader() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useDocumentSelection(node);
  return <><div data-outside>File tree and conversation</div><input aria-label="Search" />
    <button>Viewer toolbar</button><div ref={setNode} tabIndex={0}>
      <div className="output-reading-content"><h1>Document title</h1><p>The full argument.</p>
        <a href="https://example.test">A citation</a><input aria-label="Document input" /></div>
    </div></>;
}

afterEach(() => { window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
it("scopes Cmd/Ctrl+A and native context-menu selection, preserves partial copying, and releases other panes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const app = createRoot(host);
  try {
    await act(async () => app.render(<Reader />));
    const body = host.querySelector<HTMLElement>(".output-reading-content")!;
    const reader = body.parentElement!;
    const paragraph = body.querySelector("p")!;
    const selection = window.getSelection()!;
    paragraph.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    expect(document.activeElement).toBe(reader);
    for (const modifier of [{metaKey: true}, {ctrlKey: true}]) {
      const key = new KeyboardEvent("keydown", {key: "a", ...modifier, bubbles: true, cancelable: true});
      reader.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      expect(selection.toString()).toBe(body.textContent);
      expect(selection.toString()).not.toContain("File tree");
      expect(selection.toString()).not.toContain("Viewer toolbar");
    }
    const context = new MouseEvent("contextmenu", {bubbles: true, cancelable: true});
    paragraph.dispatchEvent(context);
    expect(context.defaultPrevented).toBe(false);
    // Emulate the page-wide range produced by the browser's own Select All.
    const all = document.createRange(); all.selectNodeContents(host);
    selection.removeAllRanges(); selection.addRange(all);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.toString()).toBe(body.textContent);
    const partial = document.createRange(); partial.selectNodeContents(paragraph);
    selection.removeAllRanges(); selection.addRange(partial);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.toString()).toBe("The full argument.");
    expect(selection.getRangeAt(0)).toBe(partial);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Document input"]')!;
    input.focus();
    const key = new KeyboardEvent("keydown", {key: "a", metaKey: true, bubbles: true, cancelable: true});
    input.dispatchEvent(key); expect(key.defaultPrevented).toBe(false);
    reader.focus();
    host.querySelector("[data-outside]")!.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    const elsewhere = new KeyboardEvent("keydown", {key: "a", metaKey: true, bubbles: true, cancelable: true});
    reader.dispatchEvent(elsewhere); expect(elsewhere.defaultPrevented).toBe(false);
    selection.removeAllRanges(); selection.addRange(all);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.toString()).toContain("File tree and conversation");
    host.querySelector<HTMLInputElement>('input[aria-label="Search"]')!.focus();
    selection.removeAllRanges(); selection.addRange(all);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.toString()).toContain("File tree and conversation");
    paragraph.dispatchEvent(new Event("pointerdown", {bubbles: true}));
    await act(async () => app.render(<div>Other content</div>));
    const outside = document.createRange(); outside.selectNodeContents(host);
    selection.removeAllRanges(); selection.addRange(outside);
    document.dispatchEvent(new Event("selectionchange"));
    expect(selection.toString()).toBe("Other content");
  } finally { await act(async () => app.unmount()); }
});
