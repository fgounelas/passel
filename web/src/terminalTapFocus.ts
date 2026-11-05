export type TerminalTapFocusResult = boolean | "terminal";
export type TerminalTapFocusAction = "ignore" | "redirect" | "terminal";

export function terminalTapFocusAction(
  result: TerminalTapFocusResult | undefined,
  terminalHadFocusOrGrace: boolean,
): TerminalTapFocusAction {
  if (!result) {
    return "ignore";
  }
  if (result === "terminal" && terminalHadFocusOrGrace) {
    return "ignore";
  }
  return result === "terminal" ? "terminal" : "redirect";
}
