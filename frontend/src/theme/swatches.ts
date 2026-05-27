export interface Swatch {
  start: string;
  end: string;
}

/** Preset colours shown in the account colour picker. */
export const PRESET_COLORS = [
  "#6366f1", // Indigo (default)
  "#3b82f6", // Blue
  "#0891b2", // Cyan
  "#0d9488", // Teal
  "#16a34a", // Green
  "#ca8a04", // Amber
  "#ea580c", // Orange
  "#dc2626", // Red
  "#e11d48", // Rose
  "#9333ea", // Purple
  "#c026d3", // Fuchsia
  "#475569", // Slate
] as const;

/**
 * Derive a gradient pair from a single hex colour.
 * The end colour is lightened by ~28 % for a subtle card gradient.
 */
export function colorToGradient(hex: string): Swatch {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = 0.28;
  const lr = Math.round(r + (255 - r) * mix);
  const lg = Math.round(g + (255 - g) * mix);
  const lb = Math.round(b + (255 - b) * mix);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return { start: hex, end: `#${h(lr)}${h(lg)}${h(lb)}` };
}
