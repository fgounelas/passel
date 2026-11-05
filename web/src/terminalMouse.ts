/** Herdr translates cell-based SGR reports to the foreground app's requested protocol. */
export function terminalMouseCapture(message: string): boolean | null {
  try {
    const value = JSON.parse(message);
    return value.type === "terminal_mouse_capture" && typeof value.enabled === "boolean" ? value.enabled : null;
  } catch { return null; }
}

type MouseSurface = {
  canvas(): HTMLCanvasElement | undefined;
  size(): { cols: number; rows: number };
  enabled(): boolean;
  send(data: string): void;
  focus?(): void;
};

export function installTerminalMouse(host: HTMLElement, surface: MouseSurface) {
  let pressed: { col: number; row: number } | null = null;
  let touch: { x: number; y: number; moved: boolean; startedAt: number } | null = null;
  let suppressMouseUntil = 0;
  const cell = (x: number, y: number) => {
    const rect = surface.canvas()?.getBoundingClientRect();
    const { cols, rows } = surface.size();
    if (!rect || rect.width <= 0 || rect.height <= 0 || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return null;
    return { col: Math.floor((x - rect.left) * cols / rect.width) + 1, row: Math.floor((y - rect.top) * rows / rect.height) + 1 };
  };
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const report = (position: { col: number; row: number }, up: boolean, alt = false, ctrl = false) => {
    surface.send(`\x1b[<${(alt ? 8 : 0) + (ctrl ? 16 : 0)};${position.col};${position.row}${up ? "m" : "M"}`);
  };
  const down = (event: MouseEvent) => {
    if (performance.now() < suppressMouseUntil) { consume(event); return; }
    if (!surface.enabled() || event.button !== 0 || event.shiftKey) return;
    pressed = cell(event.clientX, event.clientY);
    if (!pressed) return;
    consume(event); surface.focus?.(); report(pressed, false, event.altKey, event.ctrlKey);
  };
  const up = (event: MouseEvent) => {
    if (!pressed || event.button !== 0) return;
    const position = cell(event.clientX, event.clientY) ?? pressed;
    pressed = null;
    consume(event);
    if (surface.enabled()) report(position, true, event.altKey, event.ctrlKey);
  };
  const click = (event: MouseEvent) => {
    if (performance.now() < suppressMouseUntil || (surface.enabled() && event.button === 0 && !event.shiftKey && cell(event.clientX, event.clientY))) consume(event);
  };
  const start = (event: TouchEvent) => {
    touch = surface.enabled() && event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, moved: false, startedAt: performance.now() } : null;
  };
  const move = (event: TouchEvent) => {
    if (touch && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - touch.x, event.touches[0].clientY - touch.y) > 5)) touch.moved = true;
  };
  const end = (event: TouchEvent) => {
    const pending = touch; touch = null;
    if (!pending || !surface.enabled()) return;
    suppressMouseUntil = performance.now() + 1200;
    if (performance.now() - pending.startedAt > 500 || pending.moved || event.touches.length !== 0 || event.changedTouches.length !== 1) return;
    const point = event.changedTouches[0];
    if (Math.hypot(point.clientX - pending.x, point.clientY - pending.y) > 5) return;
    const position = cell(point.clientX, point.clientY);
    if (!position) return;
    consume(event); report(position, false); report(position, true);
  };
  const cancel = () => { touch = null; pressed = null; };
  host.addEventListener("mousedown", down, true);
  document.addEventListener("mouseup", up, true);
  host.addEventListener("click", click, true);
  host.addEventListener("dblclick", click, true);
  host.addEventListener("touchstart", start, { capture: true, passive: true });
  host.addEventListener("touchmove", move, { capture: true, passive: true });
  host.addEventListener("touchend", end, { capture: true, passive: false });
  host.addEventListener("touchcancel", cancel, true);
  window.addEventListener("blur", cancel);
  return () => {
    cancel();
    host.removeEventListener("mousedown", down, true);
    document.removeEventListener("mouseup", up, true);
    host.removeEventListener("click", click, true);
    host.removeEventListener("dblclick", click, true);
    host.removeEventListener("touchstart", start, true);
    host.removeEventListener("touchmove", move, true);
    host.removeEventListener("touchend", end, true);
    host.removeEventListener("touchcancel", cancel, true);
    window.removeEventListener("blur", cancel);
  };
}

export function terminalMouseInput(data: string) {
  if (data[0] !== "\x1b") return null;
  const match = /^\[<(0|8|16|24);([1-9]\d{0,2});([1-9]\d{0,2})([Mm])$/.exec(data.slice(1));
  if (!match) return null;
  const column = Number(match[2]) - 1, row = Number(match[3]) - 1;
  if (column >= 500 || row >= 200) return null;
  const bits = Number(match[1]);
  return { type: "mouse", down: match[4] === "M", column, row, modifiers: (bits & 8 ? 4 : 0) | (bits & 16 ? 2 : 0) };
}
