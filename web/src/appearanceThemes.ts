export const READING_FONTS = {
  geist: { label: "Geist", family: '"Geist Variable", system-ui, sans-serif' },
  system: { label: "System sans", family: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  serif: { label: "Serif", family: 'Georgia, "Times New Roman", serif' },
  mono: { label: "Monospace", family: 'ui-monospace, Menlo, Consolas, monospace' },
} as const;
const MONO_FALLBACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "JetBrainsMono Nerd Font Mono", monospace';
export const TERMINAL_FONTS = {
  system: { label: "System mono", family: MONO_FALLBACK },
  menlo: { label: "Menlo", family: `Menlo, ${MONO_FALLBACK}` },
  consolas: { label: "Consolas", family: `Consolas, ${MONO_FALLBACK}` },
  courier: { label: "Courier", family: `"Courier New", Courier, ${MONO_FALLBACK}` },
} as const;

type Palette = {
  id: string; name: string; light: boolean; bg: string; base: string; text: string;
  muted: string; accent: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string;
};
// Classic palettes adapted to Passel's UI roles. No external fonts or assets.
export const APPEARANCE_THEMES = [
  { id: "dark", name: "Dark", light: false, bg: "#11111b", base: "#1e1e2e", text: "#cdd6f4", muted: "#a6adc8", accent: "#b4befe", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#cba6f7", cyan: "#94e2d5" },
  { id: "light", name: "Light", light: true, bg: "#e6e9ef", base: "#eff1f5", text: "#4c4f69", muted: "#5c5f77", accent: "#5c5dd6", red: "#d20f39", green: "#40751b", yellow: "#946c00", blue: "#1e66f5", magenta: "#8839ef", cyan: "#087e8b" },
  { id: "gruvbox-dark", name: "Gruvbox Dark", light: false, bg: "#1d2021", base: "#282828", text: "#ebdbb2", muted: "#bdae93", accent: "#d79921", red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f", blue: "#83a598", magenta: "#d3869b", cyan: "#8ec07c" },
  { id: "gruvbox-light", name: "Gruvbox Light", light: true, bg: "#f2e5bc", base: "#fbf1c7", text: "#3c3836", muted: "#665c54", accent: "#9d5200", red: "#9d0006", green: "#566200", yellow: "#906300", blue: "#076678", magenta: "#8f3f71", cyan: "#427b58" },
  { id: "tokyo-night", name: "Tokyo Night", light: false, bg: "#16161e", base: "#1a1b26", text: "#c0caf5", muted: "#a9b1d6", accent: "#bb9af7", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff" },
  { id: "nord", name: "Nord", light: false, bg: "#242933", base: "#2e3440", text: "#eceff4", muted: "#d8dee9", accent: "#88c0d0", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#8fbcbb" },
  { id: "dracula", name: "Dracula", light: false, bg: "#21222c", base: "#282a36", text: "#f8f8f2", muted: "#b5b8ce", accent: "#bd93f9", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#a4c6ff", magenta: "#ff79c6", cyan: "#8be9fd" },
  { id: "solarized-dark", name: "Solarized Dark", light: false, bg: "#00212b", base: "#002b36", text: "#b9c9c9", muted: "#93a1a1", accent: "#61b5e4", red: "#f0706d", green: "#a7b82e", yellow: "#d2ad3b", blue: "#61b5e4", magenta: "#dc78b0", cyan: "#54c1b9" },
  { id: "solarized-light", name: "Solarized Light", light: true, bg: "#eee8d5", base: "#fdf6e3", text: "#073642", muted: "#586e75", accent: "#216b9a", red: "#bf3433", green: "#627000", yellow: "#8f6c00", blue: "#216b9a", magenta: "#a83279", cyan: "#137c77" },
  { id: "tig", name: "TIG", light: true, bg: "#f6d4e9", base: "#fff1f8", text: "#592442", muted: "#814766", accent: "#b51b75", red: "#b92f57", green: "#397553", yellow: "#946600", blue: "#8545bd", magenta: "#c12084", cyan: "#287989" },
] as const satisfies readonly Palette[];
export type ThemeId = typeof APPEARANCE_THEMES[number]["id"];
export type ReadingFont = keyof typeof READING_FONTS;
export type TerminalFont = keyof typeof TERMINAL_FONTS;
export function themeById(id: ThemeId): Palette {
  return APPEARANCE_THEMES.find(theme => theme.id === id)!;
}
export function mixColor(a: string, b: string, amount: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map(i => Math.round(channel(a, i) * amount + channel(b, i) * (1 - amount)).toString(16).padStart(2, "0")).join("");
}
export function alphaColor(hex: string, percent: number) {
  return `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${percent / 100})`;
}
export function paletteVariables(p: Palette): Record<string, string> {
  const surface = mixColor(p.text, p.base, .1);
  const values = {
    crust: p.bg, mantle: mixColor(p.bg, p.base, .5), base: p.base,
    surface0: surface, surface1: mixColor(p.text, p.base, .2), surface2: mixColor(p.text, p.base, .3),
    overlay0: p.muted, overlay1: p.muted, subtext0: p.muted, subtext1: p.text, text: p.text,
    blue: p.blue, lavender: p.accent, sapphire: p.blue, teal: p.cyan,
    green: p.green, yellow: p.yellow, peach: p.yellow, red: p.red, mauve: p.magenta,
    "app-bg": p.bg, "sidebar-bg": mixColor(p.bg, p.base, .7),
    "row-hover": mixColor(p.accent, p.bg, .08), "row-active": mixColor(p.accent, p.bg, .14),
    line: mixColor(p.text, p.bg, .14), "line-soft": mixColor(p.text, p.bg, .07),
    accent: p.accent, "accent-soft": alphaColor(p.accent, 14), "terminal-touch-marker": p.accent,
  };
  // Retain the current default exactly rather than deriving new shades for it.
  if (p.id === "dark") Object.assign(values, {
    mantle: "#181825", surface0: "#313244", surface1: "#45475a", surface2: "#585b70",
    overlay0: "#6c7086", overlay1: "#7f849c", subtext1: "#bac2de", sapphire: "#74c7ec",
    peach: "#fab387", "sidebar-bg": "#15151f", "row-hover": "#1c1c2a", "row-active": "#202036",
    line: "#262636", "line-soft": "#1d1d2b", "terminal-touch-marker": "#c2caff",
  });
  return Object.fromEntries(Object.entries(values).map(([key, value]) => ["--" + key, value]));
}
