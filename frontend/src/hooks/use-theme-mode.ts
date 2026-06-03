import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

export const THEME_CHANGE_EVENT = "orewire-theme-change";

export function getThemeMode(): ThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Reactive light/dark mode — re-run chart embeds when this value changes. */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() =>
    typeof document !== "undefined" ? getThemeMode() : "light",
  );

  useEffect(() => {
    const sync = () => setMode(getThemeMode());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      obs.disconnect();
    };
  }, []);

  return mode;
}
