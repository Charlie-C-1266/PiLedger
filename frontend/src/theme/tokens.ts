export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSoft: string;
  textMute: string;
  rule: string;
  up: string;
  down: string;
  shadow: string;
  shadowLg: string;
}

export const lightTokens: ThemeTokens = {
  bg: "#F6F6F8",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F0F4",
  text: "#0F1218",
  textSoft: "#5B6172",
  textMute: "#9CA3B5",
  rule: "rgba(15,18,24,0.07)",
  up: "#16A565",
  down: "#E25555",
  shadow: "0 1px 2px rgba(15,18,24,0.06)",
  shadowLg: "0 14px 28px rgba(15,18,24,0.18)",
};

export const darkTokens: ThemeTokens = {
  bg: "#0E0F12",
  surface: "#16181D",
  surfaceAlt: "#1E2128",
  text: "#ECEEF2",
  textSoft: "#9BA1AE",
  textMute: "#5E6573",
  rule: "rgba(255,255,255,0.07)",
  up: "#3FD79A",
  down: "#FF7A8A",
  shadow: "0 1px 2px rgba(0,0,0,0.4)",
  shadowLg: "0 14px 28px rgba(0,0,0,0.5)",
};

export const DEFAULT_ACCENT = "#0F766E";

export const ACCENT_OPTIONS = [
  "#0F766E",
  "#5546F6",
  "#0EA5A4",
  "#E5685A",
  "#1F4FB6",
] as const;

export function accentSoft(accent: string, mode: ThemeMode): string {
  if (mode === "light") {
    return `color-mix(in oklab, ${accent}, white 86%)`;
  }
  return `color-mix(in oklab, ${accent}, #0E0F12 75%)`;
}
