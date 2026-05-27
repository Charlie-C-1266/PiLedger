import { useState } from "react";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import { useTransactions } from "../hooks/useTransactions";
import { useGoals } from "../hooks/useGoals";
import { fmt, fmtShort } from "../lib/currency";
import { getSwatch } from "../theme/swatches";
import type { RangeKey, NetWorthPoint } from "../types";
import type { StackVariant } from "../components/CardStack";
import LineChart from "../components/charts/LineChart";
import Donut from "../components/charts/Donut";
import HBar from "../components/charts/HBar";
import StatCard from "../components/StatCard";
import RangePills from "../components/RangePills";
import CardStack, { VariantPicker } from "../components/CardStack";
import TxnRow from "../components/TxnRow";
import styles from "./Overview.module.css";

export default function Overview() {
  const { theme } = useTheme();
  const { data: accounts } = useAccounts();
  const { data: summary } = useSummary();
  const { data: transactions } = useTransactions({ per_page: 6 });
  const { data: goals } = useGoals();

  const [range, setRange] = useState<RangeKey>("30D");
  const { data: nwSeries } = useNetWorthSeries(range);

  const [hoverPoint, setHoverPoint] = useState<NetWorthPoint | null>(null);
  const [stackVariant, setStackVariant] = useState<StackVariant>("fan");
  const [donutHover, setDonutHover] = useState<number | null>(null);

  const currency = summary?.base_currency ?? "GBP";
  const netWorth = hoverPoint?.value ?? summary?.total ?? 0;
  const positiveAccounts = (accounts ?? []).filter(
    (a) => (a.current_balance ?? 0) > 0
  );

  // Donut slices from positive-balance accounts
  const donutSlices = positiveAccounts.map((a) => ({
    value: a.current_balance ?? 0,
    color: getSwatch(String(a.id)).start,
    label: a.name,
  }));

  const donutTotal = donutSlices.reduce((s, sl) => s + sl.value, 0);
  const hoveredSlice = donutHover !== null ? donutSlices[donutHover] : null;

  // Account lookup for TxnRow
  const accountMap = new Map(
    (accounts ?? []).map((a) => [a.id, a])
  );

  return (
    <div className={styles.grid}>
      {/* ── Left column ──────────────────────────────────── */}
      <div className={styles.left}>
        {/* 1. Net-worth hero */}
        <div className={styles.card}>
          <div className={styles.heroHeader}>
            <span className={styles.microLabel}>NET WORTH</span>
            <RangePills value={range} onChange={setRange} />
          </div>
          <div className={styles.heroValue}>{fmt(netWorth, currency)}</div>
          {summary && summary.total !== 0 && (
            <div className={styles.heroMeta}>
              <span
                className={styles.deltaPill}
                style={{
                  background: `color-mix(in oklab, ${theme.up}, transparent 86%)`,
                  color: theme.up,
                }}
              >
                {fmt(summary.assets - Math.abs(summary.debts), currency)}
              </span>
              <span className={styles.metaMute}>net position</span>
            </div>
          )}
          <span className="sr-only">
            Net worth chart, {range} range, current value {fmt(summary?.total ?? 0, currency)}
          </span>
          <LineChart
            data={nwSeries ?? []}
            height={240}
            onHover={setHoverPoint}
            currency={currency}
          />
        </div>

        {/* 2. Stat row */}
        <div className={styles.statRow}>
          <StatCard
            label="Assets"
            value={fmt(summary?.assets ?? 0, currency)}
            color={theme.up}
          />
          <StatCard
            label="Debts"
            value={fmt(Math.abs(summary?.debts ?? 0), currency)}
            color={theme.down}
          />
          <StatCard
            label="Savings rate"
            value={`${(summary?.savings_rate ?? 0).toFixed(0)}%`}
            color={theme.accent}
          />
        </div>

        {/* 3. Card stack */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>Your accounts</div>
              <div className={styles.sectionSub}>
                {stackVariant === "grid"
                  ? "Grid view"
                  : "Hover the stack to fan/reveal"}
              </div>
            </div>
            <VariantPicker value={stackVariant} onChange={setStackVariant} />
          </div>
          <CardStack
            accounts={positiveAccounts}
            variant={stackVariant}
            height={290}
          />
        </div>

        {/* 4. Recent activity */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Recent activity</div>
            <button className={styles.addPill}>+ Add transaction</button>
          </div>
          <div className={styles.txnList}>
            {(transactions ?? []).map((txn) => {
              const acc = accountMap.get(txn.account_id);
              return (
                <div key={txn.id} className={styles.txnDivider}>
                  <TxnRow
                    txn={txn}
                    accountName={acc?.name}
                    currency={acc?.currency ?? currency}
                  />
                </div>
              );
            })}
            {transactions?.length === 0 && (
              <div className={styles.empty}>No transactions yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right column ─────────────────────────────────── */}
      <div className={styles.right}>
        {/* 5. Distribution donut */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Distribution</div>
            <span className={styles.metaMute}>Hover</span>
          </div>
          <div className={styles.donutWrap}>
            <Donut
              slices={donutSlices}
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
                      currency
                    )}
                  </span>
                  <span className={styles.metaMute}>
                    {hoveredSlice
                      ? `${((hoveredSlice.value / donutTotal) * 100).toFixed(0)}%`
                      : `${positiveAccounts.length} accounts`}
                  </span>
                </div>
              }
            />
          </div>
          <div className={styles.legend}>
            {donutSlices.slice(0, 5).map((sl, i) => (
              <div
                key={i}
                className={styles.legendRow}
                style={{
                  opacity: donutHover !== null && donutHover !== i ? 0.35 : 1,
                }}
                onMouseEnter={() => setDonutHover(i)}
                onMouseLeave={() => setDonutHover(null)}
              >
                <span
                  className={styles.legendSwatch}
                  style={{ background: sl.color }}
                />
                <span className={styles.legendName}>{sl.label}</span>
                <span className={styles.legendValue}>
                  {fmt(sl.value, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 6. Goals progress */}
        <div className={styles.card}>
          <div className={styles.sectionTitle}>Goals progress</div>
          <div className={styles.goalsList}>
            {(goals ?? []).map((g) => {
              const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
              const months =
                g.monthly > 0
                  ? Math.ceil((g.target - g.saved) / g.monthly)
                  : null;
              return (
                <div key={g.id} className={styles.goalRow}>
                  <div className={styles.goalHeader}>
                    <span className={styles.goalName}>{g.name}</span>
                    <span className={styles.goalPct}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <HBar
                    value={g.saved}
                    max={g.target}
                    color={g.color}
                    height={6}
                  />
                  <div className={styles.goalFooter}>
                    {fmt(g.saved, currency)} of {fmt(g.target, currency)}
                    {months !== null && ` · ${months}mo left`}
                  </div>
                </div>
              );
            })}
            {goals?.length === 0 && (
              <div className={styles.empty}>No goals yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
