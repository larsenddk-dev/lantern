"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "lantern-theme";

/** Apply a theme by toggling classes on <html>. "system" = no class (the
 *  prefers-color-scheme media query decides). Kept in sync with the no-flash
 *  inline script in layout.tsx. */
function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  if (theme === "light") el.classList.add("light");
  else if (theme === "dark") el.classList.add("dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let saved: Theme = "system";
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch {
      /* localStorage unavailable */
    }
    setTheme(saved);
    applyTheme(saved);
  }, []);

  function cycle() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${label} — click to change`}
      aria-label={`Theme: ${label}. Click to change.`}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-80 w-full"
      style={{ color: "var(--sidebar-text)" }}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label} theme</span>
    </button>
  );
}
