"use client";

import { useTheme } from "@/context/ThemeContext";
import { IconButton } from "./actions";

const Sun = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);
const Moon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
  </svg>
);

// label is a template with {theme}, e.g. "switch to {theme} mode"
export function ThemeToggle({ label }: { label: string }) {
  const { theme, cycleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return <IconButton label={label.replace("{theme}", next)} icon={theme === "dark" ? <Moon /> : <Sun />} onClick={cycleTheme} />;
}
