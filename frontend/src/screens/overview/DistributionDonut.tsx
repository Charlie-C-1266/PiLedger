import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccounts } from "../../hooks/useAccounts";
import { useSummary } from "../../hooks/useSummary";
import { fmt, fmtShort } from "../../lib/currency";
import Donut from "../../components/charts/Donut";
import Skeleton from "../../components/Skeleton";
import { donutSlices } from "./overviewModel";
import styles from "../Overview.module.css";

/**
 * The asset-distribution donut and its accessible legend. Slices come from the
 * asset accounts (see `donutSlices`); each legend entry is a focus/hover target
 * that highlights its slice. Owns the hovered-slice UI state.
 */
export default function DistributionDonut() {
  const { data: accounts, isPending } = useAccounts();
  const { data: summary } = useSummary();
  const [donutHover, setDonutHover] = useState<number | null>(null);

  const currency = summary?.base_currency ?? "GBP";
  const slices = donutSlices(accounts ?? []);
  const donutTotal = slices.reduce((s, sl) => s + sl.value, 0);
  const hoveredSlice = donutHover !== null ? slices[donutHover] : null;

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Distribution</div>
        <span className={styles.metaMute}>Hover</span>
      </div>
      {isPending ? (
        <>
          <div className={styles.donutWrap}>
            <Skeleton width={200} height={200} radius={999} />
          </div>
          <div className={styles.legend}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.legendRow}>
                <Skeleton width={10} height={10} radius={3} />
                <span className={styles.legendName}>
                  <Skeleton width="70%" height={13} />
                </span>
                <Skeleton width={48} height={13} />
              </div>
            ))}
          </div>
        </>
      ) : donutTotal === 0 ? (
        <div className={styles.empty}>
          No asset accounts to chart yet.
          <Link to="/accounts" className={styles.emptyAction}>
            Add an account
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.donutWrap}>
            <Donut
              slices={slices}
              size={200}
              thickness={26}
              gap={3}
              hoverIdx={donutHover}
              onHover={setDonutHover}
              center={
                <div className={styles.donutCenter}>
                  <span className={styles.microLabel}>
                    {hoveredSlice ? hoveredSlice.label : "ASSETS"}
                  </span>
                  <span className={styles.donutValue}>
                    {fmtShort(
                      hoveredSlice ? hoveredSlice.value : donutTotal,
                      currency,
                    )}
                  </span>
                  <span className={styles.metaMute}>
                    {hoveredSlice
                      ? `${((hoveredSlice.value / donutTotal) * 100).toFixed(0)}%`
                      : `${slices.length} accounts`}
                  </span>
                </div>
              }
            />
          </div>
          {/* Accessible counterpart to the chart: a keyboard- and touch-reachable
              list of every segment (focus or hover to highlight it on the donut),
              plus a total. */}
          <ul className={styles.legend} aria-label="Distribution by account">
            {slices.map((sl, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={styles.legendRow}
                  style={{
                    opacity: donutHover !== null && donutHover !== i ? 0.35 : 1,
                  }}
                  onMouseEnter={() => setDonutHover(i)}
                  onMouseLeave={() => setDonutHover(null)}
                  onFocus={() => setDonutHover(i)}
                  onBlur={() => setDonutHover(null)}
                  aria-label={`${sl.label}, ${fmt(sl.value, currency)}, ${(
                    (sl.value / donutTotal) *
                    100
                  ).toFixed(0)} percent`}
                >
                  <span
                    className={styles.legendSwatch}
                    style={{ background: sl.color }}
                  />
                  <span className={styles.legendName}>{sl.label}</span>
                  <span className={styles.legendValue}>
                    {fmt(sl.value, currency)}
                  </span>
                </button>
              </li>
            ))}
            <li className={styles.legendTotal}>
              <span className={styles.legendName}>Total</span>
              <span className={styles.legendValue}>
                {fmt(donutTotal, currency)}
              </span>
            </li>
          </ul>
        </>
      )}
    </>
  );
}
