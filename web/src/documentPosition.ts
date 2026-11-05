import { useEffect } from "react";

const key = "herdr-document-positions";
export type ReadingPosition = { page: number; fraction: number };
export function documentPositionKey(url: string) {
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.delete("v");
  return parsed.origin + parsed.pathname + parsed.search;
}
export function readPosition(id: string): ReadingPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}")[id];
    return value && Number.isInteger(value.page) && value.page >= 0 &&
      Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1 ? value : null;
  } catch { return null; }
}
export function savePosition(id: string, position: ReadingPosition) {
  try {
    const previous = JSON.parse(localStorage.getItem(key) ?? "{}");
    delete previous[id];
    localStorage.setItem(key, JSON.stringify(Object.fromEntries([...Object.entries(previous), [id, position]].slice(-100))));
  } catch { /* private mode */ }
}
export function useReadingPosition(root: HTMLDivElement | null, id: string, ready: boolean, remember: boolean) {
  useEffect(() => {
    if (!root || !ready || !remember) return;
    const pages = Array.from(root.querySelectorAll<HTMLElement>(".output-pdf-page, .output-reading-content"));
    if (!pages.length) return;
    let position = readPosition(id);
    let restoring = false;
    let frame = 0;
    let timer = 0;
    const restore = () => {
      if (!position) return;
      const page = pages[Math.min(position.page, pages.length - 1)];
      restoring = true;
      root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top + page.clientHeight * position.fraction;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { restoring = false; });
    };
    const capture = () => {
      if (restoring) return;
      const top = root.getBoundingClientRect().top;
      let index = pages.findIndex(page => page.getBoundingClientRect().bottom > top);
      if (index < 0) index = pages.length - 1;
      const page = pages[index];
      position = { page: index, fraction: Math.max(0, Math.min(1, (top - page.getBoundingClientRect().top) / Math.max(1, page.clientHeight))) };
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (position) savePosition(id, position); }, 200);
    };
    restore();
    const observer = new ResizeObserver(restore);
    pages.forEach(page => observer.observe(page));
    root.addEventListener("scroll", capture);
    return () => {
      root.removeEventListener("scroll", capture);
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      if (position) savePosition(id, position);
    };
  }, [root, id, ready, remember]);
}
