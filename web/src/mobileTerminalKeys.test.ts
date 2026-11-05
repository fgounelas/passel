import { describe, expect, it } from "vitest";
import { modifiedTerminalKey } from "./mobileTerminalKeys";

describe("mobile terminal modifiers", () => {
  it("encodes every combination for all four arrows", () => {
    for (const code of "ABCD") for (let bits = 0; bits < 8; bits++) {
      const data = `\x1b[${code}`;
      expect(modifiedTerminalKey({ label: code, data }, {
        shift: Boolean(bits & 1), alt: Boolean(bits & 2), ctrl: Boolean(bits & 4),
      })).toBe(bits ? `\x1b[1;${bits + 1}${code}` : data);
    }
  });
  it("supports navigation, Shift+Tab, Alt text and existing Ctrl shortcuts", () => {
    const modifiers = { ctrl: false, alt: false, shift: true };
    expect(modifiedTerminalKey({ label: "Tab", data: "\t" }, modifiers)).toBe("\x1b[Z");
    expect(modifiedTerminalKey({ label: "Home", data: "\x1b[H" }, modifiers)).toBe("\x1b[1;2H");
    expect(modifiedTerminalKey({ label: "PgUp", data: "\x1b[5~" }, { ...modifiers, alt: true })).toBe("\x1b[5;4~");
    expect(modifiedTerminalKey({ label: "1", data: "1" }, { ...modifiers, shift: false, alt: true })).toBe("\x1b1");
    expect(modifiedTerminalKey({ label: "/", data: "/", ctrlData: "\x1f" }, { ...modifiers, shift: false, ctrl: true })).toBe("\x1f");
  });
});
