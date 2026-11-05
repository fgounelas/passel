import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { Ghostty } from "ghostty-web";
import type { GhosttyTerminal } from "ghostty-web";
import { DEFAULT_APPEARANCE, terminalAppearance } from "./appearancePrefs";
import { installLiveTerminalColors } from "./terminalThemeColors";

let ghostty: Ghostty;
beforeEach(async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync(new URL("../node_modules/ghostty-web/ghostty-vt.wasm", import.meta.url)), { env: { log() {} } });
  ghostty = new Ghostty(instance);
});
const dark = terminalAppearance(DEFAULT_APPEARANCE, true).theme;
const tig = terminalAppearance({ ...DEFAULT_APPEARANCE, theme: "tig" }, true).theme;
const color = (hex: string) => parseInt(hex.slice(1), 16);
const fg = (term: GhosttyTerminal, col: number) => { const c = term.getLine(0)![col]; return [c.fg_r, c.fg_g, c.fg_b]; };
function create() {
  return ghostty.createTerminal(30, 3, { fgColor: color(dark.foreground), bgColor: color(dark.background), palette: [color(dark.black), color(dark.red)] });
}
it("recolours real Ghostty default/ANSI cells without changing explicit RGB or the buffer", () => {
  const term = create();
  try {
    term.write("plain\x1b[31mred\x1b[38;2;12;34;56mRGB"); term.update();
    const before = term.getLine(0)!.map(c => ({ ...c })); const cursor = term.getCursor();
    const sharedOptions = { ...dark };
    const recolor = installLiveTerminalColors(term, sharedOptions);
    Object.assign(sharedOptions, tig); recolor(tig);
    expect(fg(term, 0)).toEqual([89, 36, 66]); expect(fg(term, 5)).toEqual([185, 47, 87]); expect(fg(term, 8)).toEqual([12, 34, 56]);
    expect(term.getLine(0)![0]).toMatchObject({ bg_r: 246, bg_g: 212, bg_b: 233 });
    expect(term.getCursor()).toEqual(cursor);
    // No writes or VT rebuild: native cells still retain their original colours.
    expect(term.getViewport().slice(0, 30)).toEqual(before);
    recolor(dark); expect(term.getLine(0)).toEqual(before);
  } finally { term.free(); }
});
it("also recolours history and preserves an unfinished escape sequence", () => {
  const term = create();
  try {
    term.write("older\r\nsecond\r\nthird\r\nfourth\x1b["); term.update();
    const length = term.getScrollbackLength(); expect(length).toBeGreaterThan(0);
    const history = term.getScrollbackLine(0)!.map(c => ({ ...c }));
    const recolor = installLiveTerminalColors(term, dark); recolor(tig);
    expect(term.getScrollbackLength()).toBe(length);
    expect(term.getScrollbackLine(0)![0]).toMatchObject({ codepoint: history[0].codepoint, fg_r: 89, fg_g: 36, fg_b: 66 });
    term.write("31mR"); term.update();
    const cursor = term.getCursor(); const red = term.getLine(cursor.y)![cursor.x - 1];
    expect([red.fg_r, red.fg_g, red.fg_b]).toEqual([185, 47, 87]);
    recolor(dark);
    expect(term.getScrollbackLine(0)).toEqual(history);
  } finally { term.free(); }
});
