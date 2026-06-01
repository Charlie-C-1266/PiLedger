import { fmt } from "../../lib/currency";
import type { Period } from "./period";
import styles from "./SafeToSpendCard.module.css";

interface Props {
  /** Σ (budgeted − spent) across flexible groups, monthly base (may be < 0). */
  flexRemaining: number;
  currency: string;
  factor: number;
  period: Period;
}

/**
 * Headline "safe to spend" — what's left in flexible envelopes this period,
 * clamped at zero. In the monthly view it also paces that as a per-day figure
 * over the days remaining in the month.
 */
export default function SafeToSpendCard({
  flexRemaining,
  currency,
  factor,
  period,
}: Props) {
  const remaining = Math.max(0, flexRemaining);

  const today = new Date();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();
  const daysLeft = Math.max(1, daysInMonth - today.getDate() + 1);

  const pace =
    period === "monthly"
      ? ` · about ${fmt(remaining / daysLeft, currency, { decimals: 0 })}/day for ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
      : "";

  return (
    <section className={styles.card}>
      <div className={styles.eyebrow}>Safe to spend</div>
      <div className={styles.big}>
        {fmt(remaining * factor, currency, { decimals: 0 })}
      </div>
      <div className={styles.caption}>left in flexible envelopes{pace}</div>
    </section>
  );
}
