// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useTerminalScroll } from "./useTerminalScroll";
import type { PaneInfo } from "./types";

it("bounds scroll frames, reconciles server position, and cancels queued work on pane changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const initial = { pane_id: 'one', scroll: {offset_from_bottom: 0, max_offset_from_bottom: 1000, viewport_rows: 40} } as PaneInfo;
  const fresh = { ...initial, scroll: { ...initial.scroll!, offset_from_bottom: 550 } };
  const fetch = vi.fn(async () => ({ok: true, json: async () => ({panes: [fresh]})}));
  vi.stubGlobal('fetch', fetch);
  const send = vi.fn(() => true);
  let controls!: ReturnType<typeof useTerminalScroll>;
  function Harness({pane}: {pane: PaneInfo}) {
    controls = useTerminalScroll({pane, connectionKey: 'bridge', httpUrl: path => path, send});
    return <span>{controls.scroll?.offset_from_bottom}</span>;
  }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness pane={initial} />));
    await act(async () => controls.scrollTo(600));
    expect(send.mock.calls).toEqual([[-200]]);
    await act(async () => vi.advanceTimersByTimeAsync(64));
    expect(send.mock.calls).toEqual([[-200], [-200], [-200]]);
    expect(container.textContent).toBe('600');
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(fetch).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('550');
    await act(async () => controls.scrollTo(0));
    expect(send).toHaveBeenLastCalledWith(200);
    await act(async () => root.render(<Harness pane={{ ...initial, pane_id: 'two' }} />));
    const count = send.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(send).toHaveBeenCalledTimes(count);
    expect(container.textContent).toBe('0');
    // Alternate-screen applications without host history must still receive wheel events.
    await act(async () => root.render(<Harness pane={{ ...initial, pane_id: 'two', scroll: { ...initial.scroll!, max_offset_from_bottom: 0 } }} />));
    await act(async () => controls.scrollBy(-5));
    expect(send).toHaveBeenLastCalledWith(-5);
  } finally {
    await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
