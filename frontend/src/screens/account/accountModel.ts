import type { Account, Rates } from "../../types";

/**
 * Pure helpers behind the account page: the wording and figures it derives
 * from an account, the net-worth summary and the stored FX rates. Kept out of
 * the component so each rule is easy to test on its own.
 */

const isDebt = (a: Pick<Account, "type">) => a.type === "loan" || a.type === "credit";

/** "4.10% AER", or null at 0% (the meta line leaves it out; details say "None"). */
export function rateLabel(rate: number | null | undefined): string | null {
  if (!rate || rate <= 0) return null;
  return `${rate.toFixed(2)}% AER`;
}

/**
 * Convert `amount` in `currency` into the base currency with the user's stored
 * rates. Null when a needed rate is missing — the caller hides what depends on
 * it rather than showing a figure converted 1:1 the way the summary falls back.
 */
export function toBase(
  amount: number,
  currency: string,
  rates: Pick<Rates, "base_currency" | "rates"> | undefined,
): number | null {
  if (!rates) return null;
  if (currency === rates.base_currency) return amount;
  const rate = rates.rates.find((r) => r.currency === currency)?.rate;
  return rate == null ? null : amount * rate;
}

export type NetWorthShare =
  /** A counted account that adds to net worth: "12.4% of your £X net worth". */
  | { kind: "share"; percent: number; total: number }
  /** A counted account that lowers it (a debt, or an overdrawn account):
   *  "Reduces your £X net worth by £Y". `amount` is in the base currency. */
  | { kind: "reduces"; amount: number; total: number }
  /** A set-aside account: "Not counted in your £X net worth". */
  | { kind: "excluded"; total: number };

/**
 * How one account relates to the user's Accessible net worth (`summary.total`,
 * already in the base currency). Null — hide the line — when net worth isn't
 * positive (a share of it means nothing) or, for a counted account, when its
 * currency has no stored rate. A set-aside account needs no conversion.
 */
export function netWorthShare(
  account: Pick<Account, "type" | "currency" | "current_balance" | "counts_to_net_worth">,
  total: number | undefined,
  rates: Pick<Rates, "base_currency" | "rates"> | undefined,
): NetWorthShare | null {
  if (total == null || !(total > 0)) return null;
  if (!account.counts_to_net_worth) return { kind: "excluded", total };
  const converted = toBase(account.current_balance ?? 0, account.currency, rates);
  if (converted == null) return null;
  // Mirrors /api/summary: a debt's balance is subtracted as a magnitude.
  const contribution = isDebt(account) ? -Math.abs(converted) : converted;
  if (contribution < 0) return { kind: "reduces", amount: -contribution, total };
  return { kind: "share", percent: (contribution / total) * 100, total };
}

/**
 * Parse a server timestamp. Account rows carry SQLite's `datetime('now')`
 * ("2026-10-26 09:14:00", UTC without a zone) for `created_at`, while balance
 * and transaction times are canonical ISO ("2026-10-26T09:14:00Z").
 */
export function parseServerTime(value: string): Date {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(iso);
}

/** "4 Mar 2025". */
export function formatLongDate(value: string): string {
  return parseServerTime(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today, 09:14", "Yesterday, 18:02", "2 Oct, 07:30", or with the year
 * ("2 Oct 2025, 07:30") once it's not this year. */
export function formatUpdated(value: string, now: Date = new Date()): string {
  const d = parseServerTime(value);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
