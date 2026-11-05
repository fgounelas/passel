import { useEffect } from "react";

const textInput = (target: EventTarget | null) => target instanceof Element &&
  !!target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');

/** Scope native selection to the reader without making document text editable. */
export function useDocumentSelection(root: HTMLDivElement | null) {
  useEffect(() => {
    if (!root) return;
    const doc = root.ownerDocument;
    let active = root.contains(doc.activeElement);
    const content = () => root.querySelector<HTMLElement>(".output-reading-content");
    const focus = (event: Event) => {
      active = event.target instanceof Node && root.contains(event.target);
      if (active && !textInput(event.target) && !(event.target instanceof Element && event.target.closest("a, button, summary"))) {
        root.focus({ preventScroll: true });
      }
    };
    const focused = () => { active = root.contains(doc.activeElement); };
    const selectAll = (event: KeyboardEvent) => {
      if (!active || event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey ||
          !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a" || textInput(event.target)) return;
      const body = content();
      const selection = doc.getSelection();
      if (!body || !selection) return;
      event.preventDefault(); event.stopPropagation();
      const range = doc.createRange();
      range.selectNodeContents(body);
      selection.removeAllRanges(); selection.addRange(range);
    };
    const contain = () => {
      // Native context-menu Select All has no keyboard event. Clip only while
      // this reader owns the interaction, leaving other panes and inputs alone.
      if (!active || textInput(doc.activeElement)) return;
      const body = content();
      const selection = doc.getSelection();
      if (!body || !selection || selection.isCollapsed || selection.rangeCount !== 1) return;
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(body)) return;
      const bounds = doc.createRange(); bounds.selectNodeContents(body);
      const before = range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0;
      const after = range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0;
      if (!before && !after) return;
      const clipped = range.cloneRange();
      if (before) clipped.setStart(bounds.startContainer, bounds.startOffset);
      if (after) clipped.setEnd(bounds.endContainer, bounds.endOffset);
      selection.removeAllRanges(); selection.addRange(clipped);
    };
    doc.addEventListener("pointerdown", focus, true);
    doc.addEventListener("focusin", focused);
    root.addEventListener("contextmenu", focus);
    root.addEventListener("keydown", selectAll);
    doc.addEventListener("selectionchange", contain);
    // Opening a reader from a file row should make Cmd/Ctrl+A target the file
    // immediately, without stealing focus from an input the user is editing.
    if (!textInput(doc.activeElement)) root.focus({ preventScroll: true });
    return () => {
      doc.removeEventListener("pointerdown", focus, true);
      doc.removeEventListener("focusin", focused);
      root.removeEventListener("contextmenu", focus);
      root.removeEventListener("keydown", selectAll);
      doc.removeEventListener("selectionchange", contain);
    };
  }, [root]);
}
