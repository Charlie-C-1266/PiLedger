export interface Swatch {
  start: string;
  end: string;
}

export const accountSwatches: Record<string, Swatch> = {
  emergency: { start: "#4F46E5", end: "#7B73F4" },
  "chase-cur": { start: "#1F4FB6", end: "#4A7FE0" },
  barclays: { start: "#0B7C66", end: "#2DA88E" },
  santander: { start: "#C0392B", end: "#E26B5F" },
  halifax: { start: "#3D5A80", end: "#6F8AB5" },
  "cash-isa": { start: "#B4624A", end: "#D88B72" },
  lisa: { start: "#7A5AF8", end: "#A28BFD" },
  "isa-ss": { start: "#0F766E", end: "#3FA39A" },
  "cc-stooze": { start: "#1E1E24", end: "#3A3A45" },
  "cc-chase": { start: "#312E81", end: "#5B57B0" },
  "loan-tesco": { start: "#7F1D1D", end: "#A24545" },
  "loan-watch": { start: "#451A03", end: "#754530" },
};

const fallbackSwatch: Swatch = { start: "#444444", end: "#777777" };

export function getSwatch(accountId: string | number): Swatch {
  return accountSwatches[String(accountId)] ?? fallbackSwatch;
}
