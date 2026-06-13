import type { AccountProjection } from "../../types";

export interface ProjectionSeries {
  key: string;
  name: string;
  color: string;
  currency: string;
}

export type ProjectionRow = Record<string, number | string>;

/**
 * Reshape per-account projection series into Recharts rows keyed by month
 * index. Every account is projected over the same horizon from the same "now",
 * so their `points` align index-for-index; we still tolerate differing lengths
 * by indexing defensively. Each row carries the month index, the shared date,
 * and one balance per account (`acc{id}`).
 */
export function buildProjectionRows(projections: AccountProjection[]): {
  rows: ProjectionRow[];
  series: ProjectionSeries[];
} {
  const series: ProjectionSeries[] = projections.map((p) => ({
    key: `acc${p.id}`,
    name: p.name,
    color: p.color || "#6366f1",
    currency: p.currency,
  }));

  const length = projections.reduce((m, p) => Math.max(m, p.points.length), 0);

  const rows: ProjectionRow[] = [];
  for (let i = 0; i < length; i++) {
    const row: ProjectionRow = {
      month: i,
      date: projections.find((p) => p.points[i])?.points[i]?.date ?? "",
    };
    for (const p of projections) {
      const point = p.points[i];
      if (point) row[`acc${p.id}`] = point.balance;
    }
    rows.push(row);
  }

  return { rows, series };
}
