"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

// what is drawn
type Theme = "dark" | "light";
// what the visitor chose: one of the two, or "follow my device"
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";
const ORDER: ThemePreference[] = ["light", "dark", "system"];

interface ThemeContextType {
  theme: Theme;
  preference: ThemePreference;
  // light → dark → system → light
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const isPreference = (v: unknown): v is ThemePreference => v === "light" || v === "dark" || v === "system";

// runs in <head> before the first paint, so a returning visitor never sees
// the wrong theme flash. keep in step with the provider below.
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark"&&p!=="system")p=${JSON.stringify(DEFAULT_THEME_PREFERENCE)};var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.remove("theme-dark","theme-light");r.classList.add(d?"theme-dark":"theme-light");}catch(e){}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [deviceDark, setDeviceDark] = useState(false);

  // the stored choice and the device's setting are only known in the browser
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isPreference(stored)) setPreference(stored);
    } catch {
      // storage blocked: the default stands
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setDeviceDark(mediaQuery.matches);
    const handleChange = (e: MediaQueryListEvent) => setDeviceDark(e.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const theme: Theme = preference === "system" ? (deviceDark ? "dark" : "light") : preference;

  const cycleTheme = () => {
    setPreference((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // storage blocked: the choice lasts for this visit
      }
      return next;
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    requestAnimationFrame(() => {
      root.classList.remove("theme-dark", "theme-light");
      root.classList.add(`theme-${theme}`);

      if (theme === "dark") {
        body.style.backgroundColor = "oklch(17.3% 0 0)";
      } else {
        body.style.backgroundColor = "oklch(94.9% 0 0)";
      }
      body.style.backgroundImage = "none";
    });
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, preference, cycleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// the choice that a click will move to
export function nextPreference(current: ThemePreference): ThemePreference {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}
