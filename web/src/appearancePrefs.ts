import { useMemo, useSyncExternalStore } from "react";
import { APPEARANCE_THEMES, READING_FONTS, TERMINAL_FONTS, themeById, paletteVariables, mixColor, alphaColor } from "./appearanceThemes";
import type { ThemeId, ReadingFont, TerminalFont } from "./appearanceThemes";

const KEY = "herdr-appearance-preferences";
const EVENT = "herdr-appearance-preferences-changed";
export type AppearancePrefs = {
  theme: ThemeId; followSystem: boolean; accent: string | null;
  readingFont: ReadingFont; readingSize: number; lineHeight: number; readingWidth: number;
  compactMessages: boolean; conversationOpacity: number; terminalOpacity: number;
  terminalFont: TerminalFont; reducedMotion: boolean;
};
export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: "dark", followSystem: false, accent: null,
  readingFont: "geist", readingSize: 16, lineHeight: 165, readingWidth: 900,
  compactMessages: false, conversationOpacity: 100, terminalOpacity: 100,
  terminalFont: "system", reducedMotion: false,
};
function number(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}
export function parseAppearancePrefs(raw: string | null): AppearancePrefs {
  let value: Record<string, unknown> = {};
  try { const parsed: unknown = JSON.parse(raw ?? "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed as Record<string, unknown>; } catch { /* Defaults for corrupt or old preferences. */ }
  return {
    theme: APPEARANCE_THEMES.some(t => t.id === value.theme) ? value.theme as ThemeId : "dark",
    followSystem: value.followSystem === true,
    accent: typeof value.accent === "string" && /^#[0-9a-f]{6}$/iu.test(value.accent) ? value.accent : null,
    readingFont: typeof value.readingFont === "string" && Object.hasOwn(READING_FONTS, value.readingFont) ? value.readingFont as ReadingFont : "geist",
    readingSize: number(value.readingSize, 12, 24, 16), lineHeight: number(value.lineHeight, 130, 210, 165), readingWidth: number(value.readingWidth, 560, 1400, 900),
    compactMessages: value.compactMessages === true,
    conversationOpacity: number(value.conversationOpacity, 0, 100, 100), terminalOpacity: number(value.terminalOpacity, 0, 100, 100),
    terminalFont: typeof value.terminalFont === "string" && Object.hasOwn(TERMINAL_FONTS, value.terminalFont) ? value.terminalFont as TerminalFont : "system",
    reducedMotion: value.reducedMotion === true,
  };
}
// Keep changes working in memory when browser storage is disabled.
let fallback: string | null = null;
let volatile = false;
function snapshot() { if (volatile) return fallback; try { return localStorage.getItem(KEY); } catch { return fallback; } }
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) callback(); };
  window.addEventListener(EVENT, callback); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener("storage", storage); };
}
export function useAppearancePrefs() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => parseAppearancePrefs(raw), [raw]);
}
export function updateAppearancePrefs(patch: Partial<AppearancePrefs>) {
  const value = JSON.stringify(parseAppearancePrefs(JSON.stringify({ ...parseAppearancePrefs(snapshot()), ...patch })));
  fallback = value;
  try { localStorage.setItem(KEY, value); volatile = false; } catch { volatile = true; /* In-memory preferences still apply. */ }
  window.dispatchEvent(new Event(EVENT));
}
function darkSnapshot() { return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)").matches : true; }
function subscribeSystem(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)"); query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
export function useSystemDark() { return useSyncExternalStore(subscribeSystem, darkSnapshot, () => true); }
export function effectiveTheme(prefs: AppearancePrefs, systemDark: boolean) {
  return themeById(prefs.followSystem ? systemDark ? "dark" : "light" : prefs.theme);
}
export function appearanceVariables(prefs: AppearancePrefs, systemDark: boolean): Record<string, string> {
  const palette = effectiveTheme(prefs, systemDark);
  return {
    ...paletteVariables(palette),
    ...(prefs.accent ? { "--accent": prefs.accent, "--lavender": prefs.accent, "--accent-soft": alphaColor(prefs.accent, 14) } : {}),
    "--term-bg": mixColor(palette.bg, palette.base, prefs.terminalOpacity / 100),
    "--conversation-box-bg": alphaColor(palette.bg, prefs.conversationOpacity),
    "--conversation-font": READING_FONTS[prefs.readingFont].family,
    "--conversation-font-size": `${prefs.readingSize}px`, "--conversation-line-height": String(prefs.lineHeight / 100),
    "--conversation-width": `${prefs.readingWidth}px`, "--conversation-message-padding": prefs.compactMessages ? "10px" : "18px",
    "--conversation-user-padding": prefs.compactMessages ? "8px" : "14px",
    "--terminal-font": TERMINAL_FONTS[prefs.terminalFont].family,
  };
}
export function terminalAppearance(prefs: AppearancePrefs, systemDark: boolean) {
  const p = effectiveTheme(prefs, systemDark), vars = paletteVariables(p);
  return {
    font: TERMINAL_FONTS[prefs.terminalFont].family,
    theme: {
      background: mixColor(p.bg, p.base, prefs.terminalOpacity / 100), foreground: p.text,
      cursor: p.id === "dark" && !prefs.accent ? "#f5e0dc" : prefs.accent ?? p.accent,
      selectionBackground: vars["--surface1"], black: vars["--surface1"], white: vars["--subtext1"],
      red: p.red, green: p.green, yellow: p.yellow, blue: p.blue, magenta: p.id === "dark" ? "#f5c2e7" : p.magenta, cyan: p.cyan,
      brightBlack: vars["--surface2"], brightWhite: p.muted,
      brightRed: p.red, brightGreen: p.green, brightYellow: p.yellow, brightBlue: p.blue, brightMagenta: p.id === "dark" ? "#f5c2e7" : p.magenta, brightCyan: p.cyan,
    },
  };
}
