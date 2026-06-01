const SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  CHF: "Fr.",
  NZD: "NZ$",
  SEK: "kr",
  NOK: "kr",
};

function symbol(currency: string): string {
  return SYMBOLS[currency] ?? currency + " ";
}

export function fmt(
  value: number,
  currency = "GBP",
  opts?: { decimals?: number }
): string {
  const s = symbol(currency);
  const abs = Math.abs(value);
  const dp = opts?.decimals ?? (currency === "JPY" ? 0 : 2);
  const formatted = abs.toLocaleString("en-GB", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return value < 0 ? `−${s}${formatted}` : `${s}${formatted}`;
}

export function fmtShort(value: number, currency = "GBP"): string {
  const s = symbol(currency);
  const abs = Math.abs(value);
  let short: string;
  if (abs >= 1_000_000) {
    short = (abs / 1_000_000).toFixed(1).replace(/\.0$/, "") + "m";
  } else if (abs >= 1_000) {
    short = (abs / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  } else {
    short = abs.toFixed(currency === "JPY" ? 0 : 2);
  }
  return value < 0 ? `−${s}${short}` : `${s}${short}`;
}
