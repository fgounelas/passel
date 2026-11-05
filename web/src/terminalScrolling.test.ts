import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTerminalScrollSpeed, TerminalTouchMomentum, WheelLineAccumulator } from "./terminalScrolling";

afterEach(() => vi.unstubAllGlobals());

function frames() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
  return {
    pending,
    step(time: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}

describe("terminal scrolling", () => {
  it("preserves small trackpad movement, clears stale and opposite-direction fractions", () => {
    const wheel = new WheelLineAccumulator();
    expect(wheel.take(0.4, 0)).toBe(0);
    expect(wheel.take(0.4, 10)).toBe(0);
    expect(wheel.take(0.4, 20)).toBe(1);
    expect(wheel.take(-0.8, 30)).toBe(0);
    expect(wheel.take(-0.4, 40)).toBe(-1);
    expect(wheel.take(-0.9, 400)).toBe(0);
  });

  it("validates saved speeds and retains the faster 100% default", () => {
    expect(parseTerminalScrollSpeed(undefined)).toBe(100);
    expect(parseTerminalScrollSpeed(NaN)).toBe(100);
    expect(parseTerminalScrollSpeed(0)).toBe(50);
    expect(parseTerminalScrollSpeed(999)).toBe(300);
    expect(parseTerminalScrollSpeed(175)).toBe(175);
  });

  it("coasts in the gesture direction with bounded duration, distance and sends", () => {
    const clock = frames();
    const send = vi.fn();
    const motion = new TerminalTouchMomentum(send);
    motion.begin(0);
    motion.sample(-20, 16);
    motion.release(20);
    for (let time = 36; time < 1200; time += 16) clock.step(time);
    const lines = send.mock.calls.map(([value]) => value as number);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.length).toBeLessThanOrEqual(31);
    expect(lines.every(value => value < 0)).toBe(true);
    expect(Math.abs(lines.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(55);
    expect(clock.pending.size).toBe(0);
  });

  it("cancels on a new touch or cleanup, and ignores a held finger before release", () => {
    const clock = frames();
    const send = vi.fn();
    const motion = new TerminalTouchMomentum(send);
    motion.begin(0); motion.sample(4, 16); motion.release(20);
    expect(clock.pending.size).toBe(1);
    motion.begin(24);
    clock.step(60);
    expect(send).not.toHaveBeenCalled();
    motion.sample(4, 40); motion.release(200);
    expect(clock.pending.size).toBe(0);
    motion.begin(220); motion.sample(4, 236); motion.release(240);
    motion.stop();
    expect(clock.pending.size).toBe(0);
  });

  it("does not catch up after suspension or reschedule after cancellation during a send", () => {
    const clock = frames();
    const motion = new TerminalTouchMomentum(() => motion.stop());
    motion.begin(0); motion.sample(4, 16); motion.release(20);
    clock.step(52);
    expect(clock.pending.size).toBe(0);
    motion.begin(100); motion.sample(4, 116); motion.release(120);
    clock.step(800);
    expect(clock.pending.size).toBe(0);
  });
});
