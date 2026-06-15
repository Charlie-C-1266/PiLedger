import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useTheme } from "../../theme/useTheme";
import Modal from "../Modal";
import { fmt, fmtShort } from "../../lib/currency";
import type { Goal } from "../../types";
import styles from "./GoalProjectionModal.module.css";

interface Props {
  goals: Goal[];
  currency: string;
  onClose: () => void;
}

const MIN_HORIZON = 6;
const DEFAULT_HORIZON = 24; // window for goals that grow but don't reach in range
const MAX_HORIZON = 600; // guard against a near-zero contribution exploding the axis
const MAX_POINTS = 60;

// A linked account's annual interest rate (percent) → monthly growth factor.
// Unlinked goals (no rate) collapse to 0, i.e. a straight contribution line.
function monthlyRate(goal: Goal): number {
  return (goal.interest_rate ?? 0) / 100 / 12;
}

// Month-by-month projected balance for `months` ahead: each step compounds the
// running balance and adds the contribution. Capped at the target so a reached
// goal plateaus instead of overshooting. Linear is just the rate-0 case.
function simulate(goal: Goal, months: number): number[] {
  const r = monthlyRate(goal);
  const series = [Math.min(goal.saved, goal.target)];
  let bal = goal.saved;
  for (let t = 1; t <= months; t++) {
    bal = bal * (1 + r) + goal.monthly;
    series.push(Math.min(bal, goal.target));
  }
  return series;
}

// Months until the balance first reaches the target — null if it never does
// within the guard window (e.g. no contribution and no interest).
function monthsToReach(goal: Goal): number | null {
  if (goal.saved >= goal.target) return null;
  const r = monthlyRate(goal);
  if (goal.monthly <= 0 && r <= 0) return null;
  let bal = goal.saved;
  for (let t = 1; t <= MAX_HORIZON; t++) {
    bal = bal * (1 + r) + goal.monthly;
    if (bal >= goal.target) return t;
  }
  return null;
}

/**
 * Full-width savings projection across every goal, with colour-coded filter
 * chips to focus on specific goals. Each line climbs from the goal's current
 * `saved`, compounding any linked-account interest plus the monthly
 * contribution, and plateaus when it reaches its target. Pure client-side from
 * the goals already loaded.
 */
export default function GoalProjectionModal({ goals, currency, onClose }: Props) {
  const { theme } = useTheme();

  // Only goals with a real target are projectable; default to showing them all.
  const projectable = useMemo(() => goals.filter((g) => g.target > 0), [goals]);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(projectable.map((g) => g.id))
  );

  const shown = projectable.filter((g) => selected.has(g.id));

  const { data, horizon } = useMemo(() => {
    const reachTimes = shown
      .map(monthsToReach)
      .filter((m): m is number => m !== null);
    const horizon = Math.min(
      MAX_HORIZON,
      Math.max(MIN_HORIZON, ...(reachTimes.length ? reachTimes : [DEFAULT_HORIZON]))
    );
    // Simulate each goal once over the full horizon, then sample at `step` to
    // cap the number of plotted points so a long horizon stays light.
    const step = Math.max(1, Math.ceil(horizon / MAX_POINTS));
    const series = new Map(shown.map((g) => [g.id, simulate(g, horizon)] as const));
    const rows: Array<Record<string, number>> = [];
    for (let t = 0; t <= horizon; t += step) {
      const row: Record<string, number> = { month: t };
      for (const g of shown) row[`g${g.id}`] = Math.round(series.get(g.id)![t]);
      rows.push(row);
    }
    return { data: rows, horizon };
  }, [shown]);

  const monthTick = (t: number) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + t);
    const mon = d.toLocaleDateString("en-GB", { month: "short" });
    return `${mon} '${String(d.getFullYear() % 100).padStart(2, "0")}`;
  };

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal onClose={onClose} size="wide">
        <div className={styles.head}>
          <div>
            <h2 className={styles.title}>Goal projections</h2>
            <p className={styles.sub}>
              Projected balance over the next{" "}
              {horizon >= 12
                ? `${Math.round(horizon / 12)} year${horizon >= 24 ? "s" : ""}`
                : `${horizon} months`}
              , from each goal's monthly contribution and any linked-account
              interest.
            </p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {projectable.length === 0 ? (
          <div className={styles.empty}>
            Add a goal with a target to see a projection.
          </div>
        ) : (
          <>
            <div className={styles.chips}>
              {projectable.map((g) => {
                const on = selected.has(g.id);
                return (
                  <button
                    key={g.id}
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => toggle(g.id)}
                    style={on ? { borderColor: g.color } : undefined}
                  >
                    <span
                      className={styles.dot}
                      style={{ background: on ? g.color : "var(--pl-text-mute)" }}
                    />
                    {g.name}
                  </button>
                );
              })}
            </div>

            <div className={styles.chart}>
              {shown.length === 0 ? (
                <div className={styles.empty}>Select a goal to plot it.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data}
                    margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid stroke={theme.rule} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={monthTick}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: theme.textMute, fontSize: 11 }}
                      minTickGap={40}
                    />
                    <YAxis
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: theme.textMute, fontSize: 11 }}
                      tickFormatter={(v: number) => fmtShort(v, currency)}
                      width={52}
                      tickCount={5}
                    />
                    <Tooltip
                      contentStyle={{
                        background: theme.surface,
                        border: `1px solid ${theme.rule}`,
                        borderRadius: 10,
                        boxShadow: theme.shadowLg,
                        font: '500 12px/1.4 "Plus Jakarta Sans", sans-serif',
                      }}
                      labelFormatter={(t) => monthTick(Number(t))}
                      formatter={(v) => fmt(Number(v ?? 0), currency)}
                    />
                    {shown.map((g) => (
                      <Line
                        key={g.id}
                        type="monotone"
                        dataKey={`g${g.id}`}
                        name={g.name}
                        stroke={g.color}
                        strokeWidth={2.2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
    </Modal>
  );
}
