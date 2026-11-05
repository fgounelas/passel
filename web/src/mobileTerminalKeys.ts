export type TerminalKey = { label: string; data: string; ctrlData?: string };
export type TerminalModifiers = { ctrl: boolean; alt: boolean; shift: boolean };

// Standard xterm modifier parameters: Shift=1, Alt=2, Ctrl=4, plus 1.
export function modifiedTerminalKey(key: TerminalKey, modifiers: TerminalModifiers): string {
  const { ctrl, alt, shift } = modifiers;
  const modifier = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
  if (modifier === 1) return key.data;
  const csi = key.data.startsWith("\x1b[") ? key.data.slice(2) : "";
  const navigation = /^([ABCDHF])$/.exec(csi);
  if (navigation) return `\x1b[1;${modifier}${navigation[1]}`;
  const tilde = /^(\d+)~$/.exec(csi);
  if (tilde) return `\x1b[${tilde[1]};${modifier}~`;
  let data = ctrl && key.ctrlData ? key.ctrlData : key.data;
  if (shift && data === "\t") data = "\x1b[Z";
  else if (shift && /^[a-z]$/.test(data)) data = data.toUpperCase();
  return alt ? "\x1b" + data : data;
}
