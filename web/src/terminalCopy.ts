import { isClaudeLoginUrl } from "./claudeLogin";

/** Keep ordinary selections verbatim; join only a complete, known login URL. */
export function terminalCopyText(text: string, loginUrl: () => string | undefined) {
  if (text.length > 16384 || !text.trimStart().startsWith("https://")) return text;
  const joined = text.replace(/\s/g, "");
  return isClaudeLoginUrl(joined) && joined === loginUrl() ? joined : text;
}

export function installTerminalSelectionCopy(
  host: HTMLElement,
  selection: { getSelection?: () => string } | null,
  loginUrl: () => string | undefined,
) {
  const original = selection?.getSelection;
  if (!selection || !original) return () => {};
  // Ghostty uses this for mouseup, context menus and its public getSelection.
  selection.getSelection = () => terminalCopyText(original.call(selection), loginUrl);
  const copy = (event: ClipboardEvent) => {
    const text = selection.getSelection?.();
    if (!text || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener("copy", copy);
  return () => { selection.getSelection = original; host.removeEventListener("copy", copy); };
}
