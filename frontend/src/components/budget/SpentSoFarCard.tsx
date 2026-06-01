import { fmt } from "../../lib/currency";
import HBar from "../charts/HBar";
import styles from "./SpentSoFarCard.module.css";

interface Props {
  totalSpent: number; // monthly base
  allocated: number; // monthly base
  envelopeCount: number;
  currency: string;
  factor: number;
}

/** Actual spend across every envelope so far this month, against the plan. */
export default function SpentSoFarCard({
  totalSpent,
  allocated,
  envelopeCount,
  currency,
  factor,
}: Props) {
  const planPct = Math.round((totalSpent / (allocated || 1)) * 100);

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Spent so far</span>
        <span className={styles.planPct}>{planPct}% of plan</span>
      </div>
      <div className={styles.big}>
        {fmt(totalSpent * factor, currency, { decimals: 0 })}
      </div>
      <div className={styles.bar}>
        <HBar
          value={totalSpent}
          max={allocated || 1}
          color="var(--pl-accent)"
          height={8}
        />
      </div>
      <div className={styles.caption}>
        of {fmt(allocated * factor, currency, { decimals: 0 })} allocated across{" "}
        {envelopeCount} envelope{envelopeCount === 1 ? "" : "s"}
      </div>
    </section>
  );
}
