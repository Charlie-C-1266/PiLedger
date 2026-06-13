import type { AccountHistory } from "../../types";

export interface HistorySeries {
  key: string;
  name: string;
  color: string;
  currency: string;
}

export type HistoryRow = Record<string, number | string>;

/**
 * Reshape per-account history series into Recharts rows keyed by date.
 *
 * Each account records balances at its own dates, so we union every date and
 * carry each account's last-known balance forward to the next — giving a
 * step-line where a flat stretch means "no new reading", not a drop to zero.
 * Dates before an account's first reading are left undefined so the line begins
 * at its first point rather than the chart's left edge. Accounts with no points
 * in the window are dropped from the series entirely.
 */
export function buildHistoryRows(accounts: AccountHistory[]): {
  rows: HistoryRow[];
  series: HistorySeries[];
} {
  const series: HistorySeries[] = accounts
    .filter((a) => a.history.length > 0)
    .map((a) => ({
      key: `acc${a.id}`,
      name: a.name,
      color: a.color || "#6366f1",
      currency: a.currency,
    }));

  const dates = [
    ...new Set(accounts.flatMap((a) => a.history.map((h) => h.date))),
  ].sort();

  const byKey = new Map(
    accounts.map((a) => [
      `acc${a.id}`,
      new Map(a.history.map((h) => [h.date, h.balance])),
    ])
  );

  const rows: HistoryRow[] = dates.map((date) => {
    const row: HistoryRow = { date };
    for (const s of series) {
      const point = byKey.get(s.key)?.get(date);
      if (point !== undefined) row[s.key] = point;
    }
    return row;
  });

  // Carry the last-known balance forward across gaps so the step line holds its
  // level until the next reading instead of dipping to nothing.
  const last: Record<string, number> = {};
  for (const row of rows) {
    for (const s of series) {
      if (s.key in row) last[s.key] = row[s.key] as number;
      else if (s.key in last) row[s.key] = last[s.key];
    }
  }

  return { rows, series };
}
