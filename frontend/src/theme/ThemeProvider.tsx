import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  type ThemeMode,
  DEFAULT_ACCENT,
  accentSoft,
  darkTokens,
  lightTokens,
} from "./tokens";
import { ThemeContext } from "./ThemeContext";

function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem("pl-theme-mode");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialAccent(): string {
  return localStorage.getItem("pl-theme-accent") ?? DEFAULT_ACCENT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);
  const [accent, setAccentState] = useState(getInitialAccent);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "light" ? "dark" : "light"));
  }, []);

  const setAccent = useCallback((hex: string) => {
    setAccentState(hex);
  }, []);

  useEffect(() => {
    localStorage.setItem("pl-theme-mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("pl-theme-accent", accent);
  }, [accent]);

  const theme = useMemo(() => {
    const base = mode === "light" ? lightTokens : darkTokens;
    return { ...base, accent, accentSoft: accentSoft(accent, mode) };
  }, [mode, accent]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--pl-bg", theme.bg);
    root.style.setProperty("--pl-surface", theme.surface);
    root.style.setProperty("--pl-surface-alt", theme.surfaceAlt);
    root.style.setProperty("--pl-text", theme.text);
    root.style.setProperty("--pl-text-soft", theme.textSoft);
    root.style.setProperty("--pl-text-mute", theme.textMute);
    root.style.setProperty("--pl-rule", theme.rule);
    root.style.setProperty("--pl-up", theme.up);
    root.style.setProperty("--pl-down", theme.down);
    root.style.setProperty("--pl-warn", theme.warn);
    root.style.setProperty("--pl-shadow", theme.shadow);
    root.style.setProperty("--pl-shadow-lg", theme.shadowLg);
    root.style.setProperty("--pl-accent", theme.accent);
    root.style.setProperty("--pl-accent-soft", theme.accentSoft);
  }, [theme]);

  const value = useMemo(
    () => ({ mode, accent, theme, toggleMode, setAccent }),
    [mode, accent, theme, toggleMode, setAccent]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
