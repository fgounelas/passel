import { useRef } from "react";
import type { PaneScrollInfo } from "./types";

export function TerminalScrollbar({ scroll, disabled, onScrollTo, controls }: {
  scroll?: PaneScrollInfo; disabled: boolean; onScrollTo: (offset: number) => void; controls: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; offset: number; travel: number; max: number } | null>(null);
  const max = scroll?.max_offset_from_bottom ?? 0;
  const offset = Math.min(max, Math.max(0, scroll?.offset_from_bottom ?? 0));
  const rows = scroll?.viewport_rows ?? 24;
  const fraction = Math.min(1, Math.max(.06, rows / Math.max(1, max + rows)));
  const top = max ? (1 - offset / max) * (1 - fraction) : 0;
  const unavailable = disabled || !max;
  return <div className="terminal-scrollbar" role="group" aria-label="Terminal scroll controls"
    onKeyDown={e => e.stopPropagation()}>
    <button aria-label="Scroll terminal up" title="Scroll up" disabled={unavailable || offset === max}
      onClick={() => onScrollTo(Math.min(max, offset + 3))}>▴</button>
    <div ref={track} className="terminal-scroll-track" role="scrollbar" tabIndex={unavailable ? -1 : 0}
      aria-label="Terminal history" aria-controls={controls} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={max}
      aria-valuenow={max - offset} aria-valuetext={scroll ? `${offset} lines above latest output` : "Scroll position unavailable"}
      aria-disabled={unavailable}
      onKeyDown={e => {
        if (unavailable) return;
        const next = e.key === "Home" ? max : e.key === "End" ? 0 :
          e.key === "ArrowUp" ? offset + 1 : e.key === "ArrowDown" ? offset - 1 :
          e.key === "PageUp" ? offset + rows : e.key === "PageDown" ? offset - rows : null;
        if (next !== null) { e.preventDefault(); onScrollTo(Math.max(0, Math.min(max, next))); }
      }}
      onPointerDown={e => {
        if (unavailable || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        const rect = e.currentTarget.getBoundingClientRect();
        if ((e.target as Element).closest(".terminal-scroll-thumb")) {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, offset, travel: rect.height * (1 - fraction), max };
        } else {
          onScrollTo(Math.max(0, Math.min(max, offset + (e.clientY < rect.top + top * rect.height ? rows : -rows))));
        }
      }}
      onPointerMove={e => {
        const start = drag.current;
        if (!start || start.travel <= 0) return;
        onScrollTo(Math.max(0, Math.min(start.max, Math.round(start.offset - (e.clientY - start.y) / start.travel * start.max))));
      }}
      onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="terminal-scroll-thumb" style={{ height: `${fraction * 100}%`, top: `${top * 100}%` }} />
    </div>
    <button aria-label="Scroll terminal down" title="Scroll down" disabled={unavailable || offset === 0}
      onClick={() => onScrollTo(Math.max(0, offset - 3))}>▾</button>
  </div>;
}
