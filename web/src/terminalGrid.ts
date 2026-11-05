import type { TerminalGrid } from "./terminalOutputEncoding";

export function boundedTerminalSize(size: { cols: number; rows: number }) {
  return { cols: Math.max(2, Math.min(500, size.cols)), rows: Math.max(1, Math.min(200, size.rows)) };
}

export function terminalProjectionFont(
  width: number, height: number, cell: { width: number; height: number },
  grid: TerminalGrid, preferredFont: number,
) {
  return Math.max(0.5, preferredFont * Math.min(1,
    width / (grid.cols * cell.width), height / (grid.rows * cell.height)));
}

export function prepareTerminalGrid(
  terminal: { resize: (cols: number, rows: number) => void; write: (data: string) => void; clearSelection: () => void },
  grid: TerminalGrid,
) {
  // Cancel any unfinished control string, then reset this VT in place. Ghostty
  // 0.4's public reset() frees the buffer still held by its selection manager.
  if (grid.full) { terminal.clearSelection(); terminal.write("\x18\x1bc"); }
  terminal.resize(grid.cols, grid.rows);
}
