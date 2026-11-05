// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readPosition, savePosition, useReadingPosition } from "./documentPosition";

it("restores a page after resizing, saves scrolling, and leaves disabled readers alone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  localStorage.clear();
  const host = document.createElement("div");
  const scroll = document.createElement("div");
  let height = 100;
  scroll.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  for (let i = 0; i < 3; i++) {
    const page = document.createElement("div"); page.className = "output-pdf-page";
    Object.defineProperty(page, "clientHeight", { get: () => height });
    page.getBoundingClientRect = () => ({ top: i * height - scroll.scrollTop, bottom: (i + 1) * height - scroll.scrollTop }) as DOMRect;
    scroll.append(page);
  }
  function Reader({ remember = true }) { useReadingPosition(scroll, "paper", true, remember); return null; }
  const root = createRoot(host);
  try {
    savePosition("paper", { page: 1, fraction: .5 });
    await act(async () => root.render(<Reader />));
    expect(scroll.scrollTop).toBe(150);
    vi.advanceTimersByTime(20);
    height = 200; resized();
    expect(scroll.scrollTop).toBe(300);
    vi.advanceTimersByTime(20);
    scroll.scrollTop = 440; scroll.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(250);
    expect(readPosition("paper")).toEqual({ page: 2, fraction: .2 });
    await act(async () => root.render(<Reader remember={false} />));
    scroll.scrollTop = 0; scroll.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(250);
    expect(readPosition("paper")?.page).toBe(2);
    expect(disconnect).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
