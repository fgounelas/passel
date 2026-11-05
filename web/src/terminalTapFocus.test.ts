import { describe, expect, it } from "vitest";
import { terminalTapFocusAction } from "./terminalTapFocus";

describe("terminal tap focus action", () => {
  it("ignores missing or false tap handlers", () => {
    expect(terminalTapFocusAction(undefined, false)).toBe("ignore");
    expect(terminalTapFocusAction(false, false)).toBe("ignore");
  });

  it("redirects command-input taps even when terminal focus is active", () => {
    expect(terminalTapFocusAction(true, false)).toBe("redirect");
    expect(terminalTapFocusAction(true, true)).toBe("redirect");
  });

  it("keeps terminal taps on the terminal path without repeatedly intercepting grace taps", () => {
    expect(terminalTapFocusAction("terminal", false)).toBe("terminal");
    expect(terminalTapFocusAction("terminal", true)).toBe("ignore");
  });
});
