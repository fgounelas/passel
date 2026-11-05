// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TerminalScrollbar } from "./TerminalScrollbar";

it("shows the server history position and supports keyboard and thumb dragging", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const onScrollTo = vi.fn();
  try {
    await act(async () => root.render(<TerminalScrollbar controls="terminal" disabled={false} onScrollTo={onScrollTo}
      scroll={{ offset_from_bottom: 250, max_offset_from_bottom: 1000, viewport_rows: 50 }} />));
    const track = container.querySelector('[role="scrollbar"]') as HTMLDivElement;
    expect(track.getAttribute('aria-valuenow')).toBe('750');
    expect(track.getAttribute('aria-valuetext')).toBe('250 lines above latest output');
    await act(async () => track.dispatchEvent(new KeyboardEvent('keydown', {key: 'PageUp', bubbles: true})));
    expect(onScrollTo).toHaveBeenLastCalledWith(300);
    await act(async () => track.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true})));
    expect(onScrollTo).toHaveBeenLastCalledWith(0);
    track.getBoundingClientRect = () => ({height: 100, top: 0}) as DOMRect;
    track.setPointerCapture = vi.fn();
    track.hasPointerCapture = () => false;
    await act(async () => {
      track.firstElementChild!.dispatchEvent(new MouseEvent('pointerdown', {clientY: 70, button: 0, bubbles: true}));
      track.dispatchEvent(new MouseEvent('pointermove', {clientY: 0, bubbles: true}));
    });
    expect(onScrollTo).toHaveBeenLastCalledWith(995);
    await act(async () => track.dispatchEvent(new MouseEvent('pointerup', {bubbles: true})));
    const count = onScrollTo.mock.calls.length;
    await act(async () => track.dispatchEvent(new MouseEvent('pointermove', {clientY: 100, bubbles: true})));
    expect(onScrollTo).toHaveBeenCalledTimes(count);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
