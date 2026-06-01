import { fmt } from "../../lib/currency";
import type { BudgetHistoryPoint } from "../../types";
import { PERIODS, type Period } from "./period";
import styles from "./BudgetTrend.module.css";

interface Props {
  history: BudgetHistoryPoint[];
  currency: string;
  factor: number;
  period: Period;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short" });
}

/**
 * Budget-vs-actual over the last 6 months: paired bars per month (budgeted vs
 * spent), the spent bar turning red when that month overspent. Heights are
 * ratios so the period factor cancels out — it only scales the hover tooltips.
 * The "budgeted" line is the current flat allocation (no historical snapshots).
 */
export default function BudgetTrend({ history, currency, factor, period }: Props) {
  if (history.length === 0) return null;

  const maxHist = Math.max(
    1,
    ...history.flatMap((h) => [h.budgeted, h.spent])
  );
  const show = (v: number) => fmt(v * factor, currency, { decimals: 0 });

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.title}>Budget vs actual</h2>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.swatchBudgeted}`} />
            Budgeted
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatch} ${styles.swatchSpent}`} />
            Spent
          </span>
        </div>
      </div>
      <p className={styles.sub}>
        Last 6 months, normalised to {PERIODS[period].label.toLowerCase()}
      </p>

      <div className={styles.chart}>
        {history.map((h) => {
          const over = h.spent > h.budgeted;
          return (
            <div key={h.month} className={styles.col}>
              <div className={styles.bars}>
                <div
                  className={`${styles.bar} ${styles.barBudgeted}`}
                  style={{ height: `${(h.budgeted / maxHist) * 100}%` }}
                  title={`Budgeted ${show(h.budgeted)}`}
                />
                <div
                  className={`${styles.bar} ${styles.barSpent} ${over ? styles.over : ""}`}
                  style={{ height: `${(h.spent / maxHist) * 100}%` }}
                  title={`Spent ${show(h.spent)}`}
                />
              </div>
              <div className={styles.month}>{monthLabel(h.month)}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
