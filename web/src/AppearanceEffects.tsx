import { useLayoutEffect } from "react";
import { appearanceVariables, effectiveTheme, useAppearancePrefs, useSystemDark } from "./appearancePrefs";

export function AppearanceEffects() {
  const prefs = useAppearancePrefs(), systemDark = useSystemDark();
  useLayoutEffect(() => {
    const root = document.documentElement;
    const theme = effectiveTheme(prefs, systemDark);
    const variables = appearanceVariables(prefs, systemDark);
    Object.entries(variables).forEach(([key, value]) => root.style.setProperty(key, value));
    root.style.colorScheme = theme.light ? "light" : "dark";
    root.dataset.appearanceTheme = theme.id;
    root.dataset.reducedMotion = String(prefs.reducedMotion);
    return () => {
      Object.keys(variables).forEach(key => root.style.removeProperty(key));
      root.style.removeProperty("color-scheme");
      delete root.dataset.appearanceTheme; delete root.dataset.reducedMotion;
    };
  }, [prefs, systemDark]);
  return null;
}
