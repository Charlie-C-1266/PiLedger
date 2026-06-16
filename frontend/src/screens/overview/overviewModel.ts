import type { Account, NetWorthPoint } from "../../types";

/** A single slice of the asset-distribution donut. */
export interface DonutSlice {
  value: number;
  color: string;
  label: string;
}

/**
 * Net position = assets − |debts|. A named helper so the hero and its tests
 * share one definition of the figure the "net position" pill shows.
 */
export function netPosition(assets: number, debts: number): number {
  return assets - Math.abs(debts);
}

/**
 * Percentage change in net worth from the first point of the visible trend to
 * `current` (the hovered point, else the latest). |first| is the denominator so
 * the sign reflects direction even when net worth starts negative. Returns null
 * — and the caller hides the pill — when the series is too short or starts at
 * zero, where no percentage is defined.
 */
export function pctChange(
  series: NetWorthPoint[],
  current: number | null,
): number | null {
  const firstValue = series.length > 1 ? series[0].value : null;
  if (firstValue == null || firstValue === 0 || current == null) return null;
  return ((current - firstValue) / Math.abs(firstValue)) * 100;
}

/**
 * The asset accounts that make up the distribution donut: those that count
 * toward net worth, aren't debt (loan/credit), and have a non-negative balance.
 * Mirrors /api/summary's asset classification.
 */
export function assetAccounts(accounts: Account[]): Account[] {
  return accounts.filter(
    (a) =>
      a.counts_to_net_worth &&
      a.type !== "loan" &&
      a.type !== "credit" &&
      (a.current_balance ?? 0) >= 0,
  );
}

/** Build donut slices from asset accounts, each using its stored colour. */
export function donutSlices(accounts: Account[]): DonutSlice[] {
  return assetAccounts(accounts).map((a) => ({
    value: a.current_balance ?? 0,
    color: a.color || "#6366f1",
    label: a.name,
  }));
}
