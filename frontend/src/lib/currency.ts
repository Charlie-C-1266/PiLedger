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

/**
 * Supported currencies — mirrors the backend `Currency` literal / `CURRENCY_INFO`
 * in `src/constants.py`. Adding one means appending here and in both backend spots.
 */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: "GBP", name: "British Pound" },
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
];

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? currency + " ";
}

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
