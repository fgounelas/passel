import type { GhosttyCell, GhosttyTerminal } from "ghostty-web";
import type { terminalAppearance } from "./appearancePrefs";

type Theme = ReturnType<typeof terminalAppearance>["theme"];
const ANSI_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;
type RGB = readonly [number, number, number];
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const key = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

// ghostty-web 0.4 resolves default/ANSI colours into RGB in its WASM cells and
// cannot update that configuration in place. Recolour returned render rows,
// retaining the original VT, history, cursor, selection and pending parser input.
// Its cell API loses colour provenance: RGB values equal to the original preset
// follow that preset too; unrelated application RGB colours remain unchanged.
export function installLiveTerminalColors(terminal: Pick<GhosttyTerminal, "getLine" | "getScrollbackLine">, initial: Theme) {
  // Terminal.options.theme is mutated during a live update. Retain the palette
  // the native buffer was actually created with, rather than that shared object.
  const origin = { ...initial };
  let foreground = new Map<number, RGB>(), background = new Map<number, RGB>();
  function line(cells: GhosttyCell[] | null) {
    if (!cells || (!foreground.size && !background.size)) return cells;
    return cells.map(cell => {
      const fg = foreground.get(key(cell.fg_r, cell.fg_g, cell.fg_b));
      const bg = background.get(key(cell.bg_r, cell.bg_g, cell.bg_b));
      return fg || bg ? { ...cell,
        ...(fg ? { fg_r: fg[0], fg_g: fg[1], fg_b: fg[2] } : {}),
        ...(bg ? { bg_r: bg[0], bg_g: bg[1], bg_b: bg[2] } : {}),
      } : cell;
    });
  }
  const getLine = terminal.getLine.bind(terminal), getScrollbackLine = terminal.getScrollbackLine.bind(terminal);
  terminal.getLine = row => line(getLine(row));
  terminal.getScrollbackLine = row => line(getScrollbackLine(row));
  return (next: Theme) => {
    const palette = new Map<number, RGB>();
    for (const name of ANSI_KEYS) if (origin[name] !== next[name]) palette.set(key(...rgb(origin[name])), rgb(next[name]));
    foreground = new Map(palette); background = new Map(palette);
    // Defaults take precedence when a palette entry shares the same RGB value.
    const setDefault = (map: Map<number, RGB>, source: string, target: string) => {
      const sourceKey = key(...rgb(source));
      if (source === target) map.delete(sourceKey); else map.set(sourceKey, rgb(target));
    };
    setDefault(foreground, origin.foreground, next.foreground);
    setDefault(background, origin.background, next.background);
  };
}
