/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { GhosttyRenderer } from "./terminalRenderer";

const state = vi.hoisted(() => ({ wheel: null as ((event: WheelEvent) => boolean) | null }));
vi.mock("ghostty-web", () => ({
  init: vi.fn(),
  FitAddon: class { fit() {} dispose() {} proposeDimensions() { return { cols: 100, rows: 40 }; } },
  Terminal: class {
    rows = 40;
    cols = 100;
    renderer = { getCanvas: () => document.createElement("canvas"), getMetrics: () => ({ width: 8, height: 16 }) };
    loadAddon() {} open() {} dispose() {} clearSelection() {}
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler(callback: (event: WheelEvent) => boolean) { state.wheel = callback; }
    hasMouseTracking() { return true; }
  },
}));
const renderers: GhosttyRenderer[] = [];
afterEach(() => { renderers.splice(0).forEach(renderer => renderer.dispose()); document.body.innerHTML = ""; });

it("routes mouse-reporting application wheel events to Herdr instead of arrow-key fallback", async () => {
  const renderer = new GhosttyRenderer(); renderers.push(renderer);
  const host = document.createElement("div"); document.body.append(host);
  await renderer.mount(host);
  const scroll = vi.fn(); renderer.onScroll(scroll);
  const event = new WheelEvent("wheel", { deltaY: -48, cancelable: true });
  expect(state.wheel!(event)).toBe(true);
  expect(scroll).toHaveBeenCalledWith(-3);
  expect(event.defaultPrevented).toBe(true);
});

it("allows touch scrolling in mouse-reporting applications and removes handlers on disposal", async () => {
  const renderer = new GhosttyRenderer(); renderers.push(renderer);
  const host = document.createElement("div"); document.body.append(host);
  await renderer.mount(host);
  const scroll = vi.fn(); renderer.onScroll(scroll);
  const touch = (type: string, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: 20, clientY: y }] });
    host.dispatchEvent(event);
  };
  touch("touchstart", 100); touch("touchmove", 148);
  expect(scroll).toHaveBeenCalledWith(-3);
  renderer.dispose(); renderers.pop(); scroll.mockClear();
  touch("touchstart", 100); touch("touchmove", 148);
  expect(scroll).not.toHaveBeenCalled();
});
