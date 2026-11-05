/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { GhosttyRenderer } from "./terminalRenderer";
import { DEFAULT_APPEARANCE } from "./appearancePrefs";

const state = vi.hoisted(() => ({ mounts: 0, open: vi.fn(), setTheme: vi.fn(), render: vi.fn(), write: vi.fn(), fit: vi.fn(), reset: vi.fn() }));
vi.mock("ghostty-web", () => ({
  init: vi.fn(),
  FitAddon: class {
    terminal?: { renderer: { getMetrics: () => { width: number; height: number } } };
    fit = state.fit; dispose() {}
    proposeDimensions() { const m = this.terminal!.renderer.getMetrics(); return { cols: Math.floor(800 / m.width), rows: Math.floor(640 / m.height) }; }
  },
  Terminal: class {
    rows = 40; cols = 100; viewportY = 7; wasmTerm = { getLine: () => null, getScrollbackLine: () => null, write: state.reset };
    options: Record<string, unknown>;
    rendererFont = 13;
    renderer = { getCanvas: () => document.createElement("canvas"), getMetrics: () => ({ width: 8 * this.rendererFont / 13, height: 16 * this.rendererFont / 13 }), setFontSize: (size: number) => { this.rendererFont = size; }, setTheme: state.setTheme, render: state.render, remeasureFont: vi.fn() };
    constructor(options: Record<string, unknown>) { this.options = options; state.mounts++; }
    loadAddon(addon: {terminal?: unknown}) { addon.terminal = this; } open = state.open; dispose() {} clearSelection() {} write = state.write;
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; }
    reset = state.reset;
    attachCustomKeyEventHandler() {} attachCustomWheelEventHandler() {}
  },
}));
let renderer: GhosttyRenderer;
afterEach(() => { renderer?.dispose(); document.body.innerHTML = ""; vi.clearAllMocks(); state.mounts = 0; });
it("recolours the existing renderer without replacing its buffer, viewport, or attachment", async () => {
  const host = document.createElement("div"); document.body.append(host);
  renderer = new GhosttyRenderer(); await renderer.mount(host);
  state.fit.mockClear();
  expect(renderer.setAppearance({ ...DEFAULT_APPEARANCE, theme: "tig" }, true)).toBeNull();
  expect(state.setTheme).toHaveBeenCalledWith(expect.objectContaining({ foreground: "#592442", background: "#f6d4e9" }));
  expect(state.render).toHaveBeenCalledWith(expect.anything(), true, 7, expect.anything(), 0);
  expect(state.mounts).toBe(1); expect(state.open).toHaveBeenCalledTimes(1);
  expect(state.write).not.toHaveBeenCalled(); expect(state.fit).not.toHaveBeenCalled();
  renderer.setAppearance({ ...DEFAULT_APPEARANCE, theme: "tig" }, true);
  expect(state.setTheme).toHaveBeenCalledTimes(1);
});
it("renders the server grid before bytes and projects it without resizing ahead of the next redraw", async () => {
  const host = document.createElement("div"); document.body.append(host);
  renderer = new GhosttyRenderer(); await renderer.mount(host);
  renderer.write("large snapshot", { cols: 200, rows: 80, full: true });
  expect(state.reset).toHaveBeenCalledTimes(1);
  expect(renderer.fit()).toEqual({ cols: 100, rows: 40 });
  renderer.write("partial", { cols: 200, rows: 80, full: false });
  expect(state.reset).toHaveBeenCalledTimes(1);
  renderer.write("smaller snapshot", { cols: 100, rows: 40, full: true });
  expect(state.reset).toHaveBeenCalledTimes(2);
  expect(renderer.fit()).toEqual({ cols: 100, rows: 40 });
  expect(state.mounts).toBe(1);
  expect(state.write.mock.calls.map(args => args[0])).toEqual(["large snapshot", "partial", "smaller snapshot"]);
});
it("refits only when the terminal font changes, not when conversation settings change", async () => {
  const host = document.createElement("div"); document.body.append(host);
  renderer = new GhosttyRenderer(); await renderer.mount(host); state.fit.mockClear();
  expect(renderer.setAppearance({ ...DEFAULT_APPEARANCE, readingSize: 24 }, true)).toBeNull();
  expect(state.fit).not.toHaveBeenCalled();
  expect(renderer.setAppearance({ ...DEFAULT_APPEARANCE, terminalFont: "courier" }, true)).toEqual({ cols: 100, rows: 40 });
  expect(state.fit).toHaveBeenCalledTimes(1); expect(state.mounts).toBe(1);
});
