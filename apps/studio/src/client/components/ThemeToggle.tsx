"use client";

import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

function readStoredScheme(): "light" | "dark" | null {
  try {
    const val = window.localStorage.getItem("color-scheme");
    return val === "light" || val === "dark" ? val : null;
  } catch {
    return null;
  }
}

function getSystemScheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applySchemeToDocument(stored: "light" | "dark" | null): ResolvedTheme {
  const resolved: ResolvedTheme = stored ?? getSystemScheme();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = stored ?? "light dark";
  }
  document.documentElement.classList.toggle("dark", resolved === "dark");
  return resolved;
}

export function ThemeToggle(props: { onThemeChange: (theme: ResolvedTheme) => void }) {
  const { onThemeChange } = props;
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const sync = () => {
      const next = applySchemeToDocument(readStoredScheme());
      setResolved(next);
      onThemeChange(next);
    };

    sync();

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      // Never retroactively delete a stored override when system matches it
      const next = applySchemeToDocument(readStoredScheme());
      setResolved(next);
      onThemeChange(next);
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === null || ev.key === "color-scheme") {
        sync();
      }
    };

    mq.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [onThemeChange]);

  const handleToggle = () => {
    const currentSystem = getSystemScheme();
    const currentStored = readStoredScheme();
    const currentRendered: ResolvedTheme = currentStored ?? currentSystem;
    const target: ResolvedTheme = currentRendered === "dark" ? "light" : "dark";

    const nextStored = target === currentSystem ? null : target;
    try {
      if (nextStored === null) {
        window.localStorage.removeItem("color-scheme");
      } else {
        window.localStorage.setItem("color-scheme", nextStored);
      }
    } catch {
      // Still apply to document even when storage is unavailable
    }

    const applied = applySchemeToDocument(nextStored);
    setResolved(applied);
    onThemeChange(applied);
  };

  return (
    <button
      type="button"
      className="studio-btn theme-toggle-btn"
      data-testid="theme-toggle"
      data-resolved-theme={resolved}
      onClick={handleToggle}
    >
      <span className="icon-to-dark">
        <span aria-hidden="true">☾</span>
        <span>Dark</span>
        <span className="sr-only">Switch to dark theme</span>
      </span>
      <span className="icon-to-light">
        <span aria-hidden="true">☀</span>
        <span>Light</span>
        <span className="sr-only">Switch to light theme</span>
      </span>
    </button>
  );
}
