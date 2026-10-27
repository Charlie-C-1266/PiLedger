import type {
  BalanceProjection,
  BalanceProjectionEvent,
  BalanceProjectionHorizon,
} from "../types";

/**
 * Builds a `GET /api/accounts/{aid}/projection` response for tests: daily
 * points from `asOf` to 12 months out, the four horizons, and the given events
 * with their running balance — the shape the server returns, without its
 * recurrence or interest maths.
 */

export const AS_OF = "2026-10-26";

function iso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function local(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(isoDate: string, n: number): string {
  const d = local(isoDate);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export type EventSpec = Pick<BalanceProjectionEvent, "date" | "name" | "amount"> &
  Partial<BalanceProjectionEvent>;

export function makeProjection({
  start = 1000,
  events = [],
  asOf = AS_OF,
}: {
  start?: number;
  events?: EventSpec[];
  asOf?: string;
} = {}): BalanceProjection {
  const today = local(asOf);
  const horizonDates = [1, 3, 6, 12].map((m) => {
    const d = new Date(today.getFullYear(), today.getMonth() + m, today.getDate());
    return { months: m, date: iso(d) };
  });
  const last = horizonDates[3].date;

  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let running = start;
  const full: BalanceProjectionEvent[] = sorted.map((e) => {
    running = Math.round((running + e.amount) * 100) / 100;
    return {
      subscription_id: e.kind === "interest" ? null : (e.subscription_id ?? 1),
      kind: e.amount >= 0 ? "income" : "expense",
      frequency: "monthly",
      category: "Bills",
      counterparty_name: null,
      auto_post: true,
      ...e,
      balance_after: running,
    };
  });

  const points: { date: string; balance: number }[] = [];
  let balance = start;
  let k = 0;
  for (let day = asOf; day <= last; day = addDays(day, 1)) {
    while (k < full.length && full[k].date <= day) balance = full[k++].balance_after;
    points.push({ date: day, balance });
  }

  const horizons: BalanceProjectionHorizon[] = horizonDates.map((h) => {
    const p = points.find((pt) => pt.date === h.date)!;
    return { ...h, balance: p.balance, change: Math.round((p.balance - start) * 100) / 100 };
  });
  const min = points.reduce((lo, p) => (p.balance < lo.balance ? p : lo), points[0]);
  return {
    account_id: 12,
    currency: "GBP",
    as_of: asOf,
    start_balance: start,
    points,
    horizons,
    events: full,
    summary: {
      min_balance: min.balance,
      min_date: min.date,
      first_negative_date: points.find((p) => p.balance < 0)?.date ?? null,
      end_balance: points[points.length - 1].balance,
    },
  };
}
