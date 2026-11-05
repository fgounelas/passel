/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { installTerminalMouse, terminalMouseCapture, terminalMouseInput } from "./terminalMouse";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); document.body.innerHTML = ""; vi.restoreAllMocks(); });
function fixture() {
  const host = document.createElement("div"), canvas = document.createElement("canvas");
  host.append(canvas); document.body.append(host);
  // CSS-scaled server grid: use displayed geometry, not backing pixels or preferred font.
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, right: 420, bottom: 230, width: 400, height: 200 } as DOMRect);
  const send = vi.fn(); let enabled = true;
  const cleanup = installTerminalMouse(host, { canvas: () => canvas, size: () => ({ cols: 100, rows: 40 }), enabled: () => enabled, send });
  cleanups.push(cleanup);
  const mouse = (type: string, extra = {}) => canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 418, clientY: 32, ...extra }));
  const touch = (type: string, x = 418, y = 32, count = 1) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const points = Array.from({ length: count }, () => ({ clientX: x, clientY: y }));
    Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : points }, changedTouches: { value: points } });
    canvas.dispatchEvent(event); return event;
  };
  return { host, send, mouse, touch, cleanup, disable: () => { enabled = false; } };
}
it("forwards exactly one primary press/release at the displayed cell and blocks local link/selection handlers", () => {
  const f = fixture(); const local = vi.fn(); f.host.addEventListener("mousedown", local);
  f.mouse("mousedown"); f.mouse("mouseup"); f.mouse("click");
  expect(f.send.mock.calls).toEqual([["\x1b[<0;100;1M"], ["\x1b[<0;100;1m"]]);
  expect(local).not.toHaveBeenCalled();
});
it("preserves Shift selection, secondary context menus and shell clicks; ignores outside pixels", () => {
  const f = fixture();
  f.mouse("mousedown", { shiftKey: true }); f.mouse("mouseup", { shiftKey: true });
  f.mouse("mousedown", { button: 2 }); f.mouse("mouseup", { button: 2 });
  f.mouse("mousedown", { clientX: 420 }); f.mouse("mouseup");
  f.disable(); f.mouse("mousedown"); f.mouse("mouseup");
  expect(f.send).not.toHaveBeenCalled();
});
it("sends a tap pair without duplicating synthetic mouse events or stealing a swipe", () => {
  const f = fixture();
  f.touch("touchstart"); expect(f.touch("touchend").defaultPrevented).toBe(true);
  f.mouse("mousedown"); f.mouse("mouseup"); f.mouse("click");
  expect(f.send).toHaveBeenCalledTimes(2);
  f.send.mockClear(); f.touch("touchstart"); f.touch("touchmove", 418, 80); f.touch("touchend", 418, 80);
  expect(f.send).not.toHaveBeenCalled();
});
it("does not click after multiple fingers, cancellation or disposal", () => {
  const f = fixture(); f.touch("touchstart"); f.touch("touchmove", 418, 32, 2); f.touch("touchend");
  f.touch("touchstart"); f.touch("touchcancel"); f.touch("touchend");
  f.cleanup(); f.mouse("mousedown"); f.mouse("mouseup"); f.touch("touchstart"); f.touch("touchend");
  expect(f.send).not.toHaveBeenCalled();
});
it("accepts only explicit bounded boolean mouse notifications", () => {
  expect(terminalMouseCapture('{"type":"terminal_mouse_capture","enabled":true}')).toBe(true);
  expect(terminalMouseCapture('{"type":"terminal_mouse_capture","enabled":false}')).toBe(false);
  for (const value of ['null', '{}', '{"type":"terminal_mouse_capture","enabled":"true"}', 'garbage']) expect(terminalMouseCapture(value)).toBeNull();
});

it("converts reports to bounded native cell events with native modifier bits", () => {
  expect(terminalMouseInput("\x1b[<24;500;200m")).toEqual({ type: "mouse", down: false, column: 499, row: 199, modifiers: 6 });
  for (const data of ["\x1b[<0;501;1M", "\x1b[<0;1;201M", "\x1b[<0;0;1M", "\x1b[<1;1;1M", "\x1b[<0;1;1Mextra"]) expect(terminalMouseInput(data)).toBeNull();
});

it("does not turn a stationary long press into an application click", () => {
  const f = fixture(); const now = vi.spyOn(performance, "now").mockReturnValue(0);
  f.touch("touchstart"); now.mockReturnValue(600); f.touch("touchend");
  f.mouse("mousedown"); f.mouse("mouseup"); f.mouse("click");
  expect(f.send).not.toHaveBeenCalled();
});
