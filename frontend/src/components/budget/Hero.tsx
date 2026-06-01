import PeriodToggle from "./PeriodToggle";
import type { Period } from "./period";
import { CheckIcon } from "../icons";
import { fmt } from "../../lib/currency";
import styles from "./Hero.module.css";

export interface HeroSegment {
  id: number;
  name: string;
  color: string;
  total: number; // monthly base allocation for the group
}

interface Props {
  incomeTotal: number; // monthly base
  allocated: number; // monthly base
  segments: HeroSegment[];
  currency: string;
  factor: number;
  period: Period;
  onPeriodChange: (p: Period) => void;
}

/**
 * "Left to budget" hero: the headline figure for a zero-based budget. Tracks
 * income − allocated and shifts colour + copy across three states — under
 * (amber, money still to assign), exactly zero (green, every pound assigned),
 * and over (red, allocated more than earned). Below sits the allocation balance
 * bar (one segment per group) and the Income / Allocated / Left stat row. Every
 * money figure is scaled by the active period factor.
 */
export default function Hero({
  incomeTotal,
  allocated,
  segments,
  currency,
  factor,
  period,
  onPeriodChange,
}: Props) {
  const left = incomeTotal - allocated;
  const stateClass = left === 0 ? styles.up : left > 0 ? styles.warn : styles.down;
  const label =
    left === 0 ? "Every pound assigned" : left > 0 ? "Left to budget" : "Over budget";
  const sentence =
    left > 0
      ? "Assign the rest into an envelope to hit zero — that’s a zero-based budget."
      : left < 0
        ? "You’ve allocated more than you earn. Trim an envelope to balance."
        : "Nice — income minus envelopes equals zero.";

  const show = (v: number) => fmt(v * factor, currency, { decimals: 0 });

  return (
    <section className={styles.hero}>
      <div className={styles.head}>
        <div>
          <div className={styles.eyebrow}>{label}</div>
          <div className={styles.bigRow}>
            {left === 0 && (
              <span className={styles.checkBadge}>
                <CheckIcon />
              </span>
            )}
            <div className={`${styles.big} ${stateClass}`}>{show(Math.abs(left))}</div>
          </div>
          <p className={styles.sentence}>{sentence}</p>
        </div>
        <PeriodToggle value={period} onChange={onPeriodChange} />
      </div>

      <div className={styles.barWrap}>
        <div className={styles.track}>
          {segments.map((g) => (
            <div
              key={g.id}
              className={styles.segment}
              title={g.name}
              style={{
                width: `${(g.total / (incomeTotal || 1)) * 100}%`,
                background: g.color,
              }}
            />
          ))}
          {left < 0 && <div className={styles.hatch} />}
        </div>
        <div className={styles.stats}>
          <Stat label="Income" value={show(incomeTotal)} />
          <Stat label="Allocated" value={show(allocated)} />
          <Stat label={label} value={show(Math.abs(left))} valueClass={stateClass} />
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
