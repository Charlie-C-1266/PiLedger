import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useTheme } from "../../theme/useTheme";
import { useAccounts } from "../../hooks/useAccounts";
import { useSummary } from "../../hooks/useSummary";
import { useNetWorthSeries } from "../../hooks/useNetWorthSeries";
import { fmt } from "../../lib/currency";
import type { NetWorthPoint, RangeKey } from "../../types";
import LineChart from "../../components/charts/LineChart";
import RangePills from "../../components/RangePills";
import Skeleton from "../../components/Skeleton";
import AccountProjectionsModal from "../../components/accounts/AccountProjectionsModal";
import { netPosition, pctChange } from "./overviewModel";
import styles from "../Overview.module.css";

/**
 * The net-worth hero: the Accessible net-worth headline, a net-position pill and
 * a range-scoped %-change pill, and the trend chart. Owns the selected range, the
 * hovered chart point (which drives both the headline and the %-change), and the
 * savings-projections modal. Headline + trend are already restricted server-side
 * to counting accounts (ADR-0003).
 */
export default function NetWorthHero() {
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary, isPending: summaryPending } = useSummary();

  const [range, setRange] = useState<RangeKey>("30D");
  const { data: nwSeries, isPending: seriesPending } = useNetWorthSeries(range);

  const [hoverPoint, setHoverPoint] = useState<NetWorthPoint | null>(null);
  const [showProjections, setShowProjections] = useState(false);

  const currency = summary?.base_currency ?? "GBP";
  const netWorth = hoverPoint?.value ?? summary?.total ?? 0;
  // The projections modal covers savings accounts only, so only offer it when
  // the user has at least one (matches /api/projections' server-side filter).
  const hasSavings = (accounts ?? []).some((a) => a.type === "savings");

  // %-change across the selected range, from the first trend point to the value
  // shown in the headline (hovered point, else latest).
  const series = nwSeries ?? [];
  const currentValue = hoverPoint?.value ?? series[series.length - 1]?.value ?? null;
  const pct = pctChange(series, currentValue);
  const pctUp = pct != null && pct >= 0;
  const pctColor = pctUp ? theme.up : theme.down;
  // Net position = assets − debts; colour the pill by its sign so a net-negative
  // position shows red. Guarded by the `summary.total !== 0` render condition.
  const netPos = netPosition(summary?.assets ?? 0, summary?.debts ?? 0);
  const netPositionColor = netPos >= 0 ? theme.up : theme.down;

  return (
    <>
      <div className={styles.heroHeader}>
        <span className={styles.microLabel}>ACCESSIBLE NET WORTH</span>
        <RangePills value={range} onChange={setRange} />
      </div>
      {summaryPending ? (
        <>
          <Skeleton width={220} height={46} radius={10} style={{ marginBottom: 8 }} />
          <Skeleton width={180} height={22} radius={999} style={{ marginBottom: 16 }} />
        </>
      ) : (
        <div className={styles.heroValue}>{fmt(netWorth, currency)}</div>
      )}
      {!summaryPending && summary && summary.total !== 0 && (
        <div className={styles.heroMeta}>
          <span
            className={styles.deltaPill}
            style={{
              background: `color-mix(in oklab, ${netPositionColor}, transparent 90%)`,
              color: netPositionColor,
            }}
          >
            {fmt(netPos, currency)}
          </span>
          <span className={styles.metaMute}>net position</span>
          {pct != null && (
            <>
              <span
                className={styles.deltaPill}
                style={{
                  background: `color-mix(in oklab, ${pctColor}, transparent 90%)`,
                  color: pctColor,
                }}
                title={`Net worth change over the ${range} period`}
                aria-label={`Net worth ${pctUp ? "up" : "down"} ${Math.abs(pct).toFixed(1)} percent over ${range}`}
              >
                {pctUp ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
              </span>
              <span className={styles.metaMute}>{range}</span>
            </>
          )}
        </div>
      )}
      <span className="sr-only">
        {summaryPending
          ? "Net worth chart loading"
          : `Net worth chart, ${range} range, current value ${fmt(summary?.total ?? 0, currency)}`}
      </span>
      {seriesPending ? (
        <Skeleton height={240} radius={12} />
      ) : (
        <LineChart
          data={nwSeries ?? []}
          height={240}
          onHover={setHoverPoint}
          currency={currency}
        />
      )}
      {hasSavings && (
        <div className={styles.projectionsRow}>
          <button
            className={styles.addPill}
            onClick={() => setShowProjections(true)}
          >
            Savings projections →
          </button>
        </div>
      )}

      <AnimatePresence>
        {showProjections && (
          <AccountProjectionsModal
            key="projections"
            currency={currency}
            onClose={() => setShowProjections(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
