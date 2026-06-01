import { useState } from "react";
import { fmt, fmtShort } from "../../lib/currency";
import Donut from "../charts/Donut";
import styles from "./AllocationDonut.module.css";

export interface DonutSlice {
  label: string;
  value: number; // monthly base group total
  color: string;
}

interface Props {
  slices: DonutSlice[];
  allocated: number; // monthly base
  currency: string;
  factor: number;
}

/** "Where it goes" — allocation split by group, with a cross-highlighting legend. */
export default function AllocationDonut({
  slices,
  allocated,
  currency,
  factor,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const pct = (v: number) => Math.round((v / (allocated || 1)) * 100);

  if (allocated === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.title}>Where it goes</h2>
        <p className={styles.empty}>
          Nothing allocated yet. Budget an envelope to see the split.
        </p>
      </section>
    );
  }

  const active = hover != null ? slices[hover] : null;

  return (
    <section className={styles.card}>
      <h2 className={styles.title}>Where it goes</h2>
      <div className={styles.chart}>
        <Donut
          slices={slices}
          size={186}
          thickness={24}
          gap={3}
          hoverIdx={hover}
          onHover={setHover}
          ariaLabel="Allocation by group"
          center={
            <>
              <div className={styles.centerEyebrow}>
                {active ? active.label : "Allocated"}
              </div>
              <div className={styles.centerValue}>
                {fmtShort((active ? active.value : allocated) * factor, currency)}
              </div>
              <div className={styles.centerSub}>
                {active ? `${pct(active.value)}%` : `${slices.length} groups`}
              </div>
            </>
          }
        />
      </div>
      <div className={styles.legend}>
        {slices.map((s, i) => (
          <div
            key={i}
            className={styles.legendRow}
            style={{ opacity: hover == null || hover === i ? 1 : 0.35 }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className={styles.swatch} style={{ background: s.color }} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendPct}>{pct(s.value)}%</span>
            <span className={styles.legendAmount}>
              {fmt(s.value * factor, currency, { decimals: 0 })}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
