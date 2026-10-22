"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemePreference = "system" | "light" | "dark";
const storageKey = "socialflow-theme";

function savedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => { setPreference(savedPreference()); }, []);

  useEffect(() => {
    if (preference === null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  const value = preference ?? "system";
  const Icon = value === "dark" ? Moon : value === "light" ? Sun : Monitor;

  return (
    <label className="theme-switcher inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-2.5 text-[var(--text-secondary)]">
      <Icon size={15} aria-hidden="true" />
      <span className="sr-only">Theme</span>
      <select
        aria-label="Theme"
        value={value}
        onChange={(event) => {
          const next = event.target.value as ThemePreference;
          setPreference(next);
          try { localStorage.setItem(storageKey, next); } catch { /* The active theme still works for this visit. */ }
        }}
        className="w-[76px] appearance-none border-0 bg-transparent pr-1 text-[12px] font-semibold outline-none"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
