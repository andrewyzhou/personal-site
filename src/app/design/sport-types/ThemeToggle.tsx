"use client";

import { nextPreference, useTheme } from "@/context/ThemeContext";

export default function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="font-sans text-off-white text-sm card-bg rounded-lg"
      style={{ padding: "6px 12px" }}
      data-testid="theme-toggle"
    >
      {`${nextPreference(preference)} mode`}
    </button>
  );
}
