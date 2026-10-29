"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";

type ThemePreference = "system" | "light" | "dark";
const storageKey = "socialflow-theme";
const themes = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Partial<Record<ThemePreference, HTMLButtonElement | null>>>({});
  const menuId = useId();

  useEffect(() => { setPreference(savedPreference()); }, []);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(savedPreference());
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const value = preference ?? "system";
  const current = themes.find((theme) => theme.value === value) ?? themes[0];

  function choose(next: ThemePreference) {
    setPreference(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The active theme still works for this visit. */ }
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="theme-switcher relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold"
        aria-label={`Theme: ${current.label}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setOpen(true);
            requestAnimationFrame(() => optionRefs.current[value]?.focus());
          }
        }}
      >
        <current.Icon size={15} aria-hidden="true" />
        <span>{current.label}</span>
        <ChevronDown size={13} aria-hidden="true" className={`ml-0.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={menuId} role="group" aria-label="Choose theme" className="theme-switcher-menu absolute right-0 top-[calc(100%+8px)] z-50 min-w-[150px] rounded-xl border p-1.5 shadow-xl">
          {themes.map((theme) => (
            <button
              key={theme.value}
              ref={(node) => { optionRefs.current[theme.value] = node; }}
              type="button"
              aria-pressed={theme.value === value}
              className="theme-switcher-option flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium"
              onClick={() => choose(theme.value)}
            >
              <theme.Icon size={15} aria-hidden="true" />
              <span className="flex-1">{theme.label}</span>
              {theme.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
