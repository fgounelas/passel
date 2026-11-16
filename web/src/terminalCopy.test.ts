// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { installTerminalSelectionCopy, terminalCopyText } from "./terminalCopy";

const url = "https://claude.com/cai/oauth/authorize?client_id=test&response_type=code&state=opaque%2Bstate&code_challenge=opaque-challenge";
const wrapped = url.match(/.{1,42}/g)!.map(line => "  " + line).join("\n");

it("joins a complete selected login URL, preserving ordinary and partial selections verbatim", () => {
  expect(terminalCopyText(wrapped, () => url)).toBe(url);
  for (const text of ["two\nlines", wrapped.slice(0, -1), wrapped + "\nNext prompt", wrapped.replace("https:", "http:")]) {
    expect(terminalCopyText(text, () => url)).toBe(text);
  }
  expect(terminalCopyText(wrapped, () => undefined)).toBe(wrapped);
});

it("uses the same complete text for mouseup, context menu and native copy; restores hooks on disposal", () => {
  const host = document.createElement("div"), original = () => wrapped;
  const selection = { getSelection: original };
  const cleanup = installTerminalSelectionCopy(host, selection, () => url);
  expect(selection.getSelection()).toBe(url);
  const copy = new Event("copy", { bubbles: true, cancelable: true });
  const setData = vi.fn(); Object.defineProperty(copy, "clipboardData", { value: { setData } });
  host.dispatchEvent(copy);
  expect(setData).toHaveBeenCalledWith("text/plain", url);
  expect(copy.defaultPrevented).toBe(true);
  cleanup(); expect(selection.getSelection).toBe(original);
  setData.mockClear(); host.dispatchEvent(new Event("copy")); expect(setData).not.toHaveBeenCalled();
});
