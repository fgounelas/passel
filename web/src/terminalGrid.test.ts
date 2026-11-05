import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Ghostty } from "ghostty-web";
import { boundedTerminalSize, prepareTerminalGrid, terminalProjectionFont } from "./terminalGrid";

let ghostty: Ghostty;
beforeEach(async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync(new URL("../node_modules/ghostty-web/ghostty-vt.wasm", import.meta.url)), { env: { log() {} } });
  ghostty = new Ghostty(instance);
});
it("rebuilds a full snapshot from clean VT state and preserves incremental escape parsing", () => {
  const term = ghostty.createTerminal(10, 4);
  const adapter = {
    clearSelection: vi.fn(),
    write(data: string) { term.write(data); },
    resize(cols: number, rows: number) { term.resize(cols, rows); },
  };
  const snapshot = "\x1b[2J\x1b[HTheorem\x1b[4;1H❯ reply";
  const line = (row: number) => term.getLine(row)!.map(c => String.fromCodePoint(c.codepoint || 32)).join("").trimEnd();
  try {
    term.write("\x1b[2;3r\x1b[?6h"); term.write(snapshot); term.update();
    expect(line(0)).not.toBe("Theorem");
    prepareTerminalGrid(adapter, { cols: 10, rows: 4, full: true });
    term.write(snapshot); term.update();
    expect(line(0)).toBe("Theorem"); expect(line(3)).toBe("❯ reply");
    term.write("\x1b]0;unfinished title");
    prepareTerminalGrid(adapter, { cols: 10, rows: 4, full: true });
    term.write(snapshot); term.update();
    expect(line(0)).toBe("Theorem"); expect(line(3)).toBe("❯ reply");
    term.write("\x1b[1;1H\x1b[31");
    prepareTerminalGrid(adapter, { cols: 10, rows: 4, full: false });
    term.write("mR"); term.update();
    expect(line(0)).toBe("Rheorem");
    expect(adapter.clearSelection).toHaveBeenCalledTimes(2);
  } finally { term.free(); }
});
it("fits oversized shared grids into the viewport without increasing the preferred font", () => {
  expect(terminalProjectionFont(800, 640, { width: 8, height: 16 }, { cols: 200, rows: 80, full: true }, 13)).toBe(6.5);
  expect(terminalProjectionFont(800, 640, { width: 8, height: 16 }, { cols: 50, rows: 20, full: true }, 13)).toBe(13);
  expect(boundedTerminalSize({ cols: 65535, rows: 65535 })).toEqual({ cols: 500, rows: 200 });
});
