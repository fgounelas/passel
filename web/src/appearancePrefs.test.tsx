/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppearanceEffects } from "./AppearanceEffects";
import { APPEARANCE_THEMES } from "./appearanceThemes";
import { appearanceVariables, DEFAULT_APPEARANCE, effectiveTheme, parseAppearancePrefs, terminalAppearance, updateAppearancePrefs } from "./appearancePrefs";
let root: Root | undefined;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  document.body.innerHTML = ""; vi.restoreAllMocks();
  updateAppearancePrefs(DEFAULT_APPEARANCE); localStorage.clear();
});
it("recovers invalid stored preferences and bounds reading/opacity values", () => {
  for (const raw of [null, "null", "[]", '"bad"', "oops"]) expect(parseAppearancePrefs(raw)).toEqual(DEFAULT_APPEARANCE);
  const p = parseAppearancePrefs(JSON.stringify({ theme: "unknown", readingFont: "__proto__", terminalFont: "constructor", accent: "url(bad)", readingSize: 99, lineHeight: -5, terminalOpacity: 200, conversationOpacity: -10 }));
  expect(p).toMatchObject({ theme: "dark", readingFont: "geist", terminalFont: "system", accent: null, readingSize: 24, lineHeight: 130, terminalOpacity: 100, conversationOpacity: 0 });
});
it("retains the original default colours and changes background opacity without dimming text", () => {
  const defaultColors = terminalAppearance(DEFAULT_APPEARANCE, true).theme;
  expect(defaultColors).toMatchObject({ background: "#11111b", foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#45475a", magenta: "#f5c2e7" });
  const low = { ...DEFAULT_APPEARANCE, terminalOpacity: 0, conversationOpacity: 0 };
  expect(terminalAppearance(low, true).theme).toMatchObject({ background: "#1e1e2e", foreground: defaultColors.foreground });
  expect(appearanceVariables(low, true)["--conversation-box-bg"]).toBe("rgba(17, 17, 27, 0)");
});
it("keeps body and secondary text readable in all ten palettes", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(i => { const x = parseInt(hex.slice(i, i + 2), 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return r * .2126 + g * .7152 + b * .0722;
  };
  expect(APPEARANCE_THEMES).toHaveLength(10);
  for (const p of APPEARANCE_THEMES) for (const color of [p.text, p.muted]) {
    const a = luminance(p.base), b = luminance(color);
    expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), p.name + " text contrast").toBeGreaterThanOrEqual(4.5);
  }
});
it("uses device light/dark only when enabled", () => {
  expect(effectiveTheme({ ...DEFAULT_APPEARANCE, theme: "tig" }, true).id).toBe("tig");
  expect(effectiveTheme({ ...DEFAULT_APPEARANCE, theme: "tig", followSystem: true }, false).id).toBe("light");
});
it("applies and synchronises preferences without leaving stale theme variables", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<AppearanceEffects />));
  await act(async () => updateAppearancePrefs({ theme: "tig", accent: "#765432", reducedMotion: true, readingFont: "serif" }));
  expect(document.documentElement.dataset.appearanceTheme).toBe("tig");
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#765432");
  expect(document.documentElement.style.getPropertyValue("--conversation-font")).toContain("Georgia");
  await act(async () => {
    localStorage.setItem("herdr-appearance-preferences", JSON.stringify({ theme: "nord" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "herdr-appearance-preferences" }));
  });
  expect(document.documentElement.dataset.appearanceTheme).toBe("nord");
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#88c0d0");
  await act(async () => root!.unmount()); root = undefined;
  expect(document.documentElement.style.getPropertyValue("--base")).toBe("");
  expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
});
it("still applies changes when storage writes are blocked", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<AppearanceEffects />));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
  await act(async () => updateAppearancePrefs({ theme: "light" }));
  expect(document.documentElement.dataset.appearanceTheme).toBe("light");
});
