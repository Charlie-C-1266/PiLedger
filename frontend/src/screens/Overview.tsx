import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../theme/useTheme";
import { useAccounts } from "../hooks/useAccounts";
import { useSummary } from "../hooks/useSummary";
import { useNetWorthSeries } from "../hooks/useNetWorthSeries";
import { useTransactions } from "../hooks/useTransactions";
import { useGoals } from "../hooks/useGoals";
import { fmt, fmtShort } from "../lib/currency";
import type { AccountType, RangeKey, NetWorthPoint } from "../types";
import type { StackVariant } from "../components/CardStack";
import LineChart from "../components/charts/LineChart";
import Donut from "../components/charts/Donut";
import HBar from "../components/charts/HBar";
import StatCard from "../components/StatCard";
import RangePills from "../components/RangePills";
import CardStack from "../components/CardStack";
import StackControls from "../components/StackControls";
import TxnRow from "../components/TxnRow";
import AddModal from "../components/AddModal";
import AddGoalModal from "../components/AddGoalModal";
import styles from "./Overview.module.css";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  current: "Current",
  savings: "Savings",
  loan: "Loan",
  credit: "Credit",
  invest: "Invest",
};

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
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountType | "">("");
  const [donutHover, setDonutHover] = useState<number | null>(null);
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);

  const currency = summary?.base_currency ?? "GBP";
  // Headline is Accessible net worth (ADR-0003): summary.total and the trend
  // series are already restricted to counting accounts server-side.
  const netWorth = hoverPoint?.value ?? summary?.total ?? 0;
  const setAside = summary?.set_aside ?? 0;

  // Percentage change in net worth across the selected range: from the first
  // point in the trend to the value shown in the headline (which follows the
  // hovered point, else the latest). |first| is the denominator so the sign
  // reflects direction even when net worth starts negative. Null — and the pill
  // hidden — when the series is too short or starts at zero (no defined %).
  const series = nwSeries ?? [];
  const firstValue = series.length > 1 ? series[0].value : null;
  const currentValue = hoverPoint?.value ?? series[series.length - 1]?.value ?? null;
  const pctChange =
    firstValue != null && firstValue !== 0 && currentValue != null
      ? ((currentValue - firstValue) / Math.abs(firstValue)) * 100
      : null;
  const pctUp = pctChange != null && pctChange >= 0;
  const pctColor = pctUp ? theme.up : theme.down;
  // Asset accounts with a positive balance that count toward net worth — the
  // donut is the Accessible "ASSETS" distribution, so loan/credit (debt) and
  // set-aside accounts are excluded. Mirrors /api/summary's classification.
  const positiveAccounts = (accounts ?? []).filter(
    (a) =>
      a.counts_to_net_worth &&
      a.type !== "loan" &&
      a.type !== "credit" &&
      (a.current_balance ?? 0) >= 0
  );

  const stackAccounts = useMemo(() => {
    const all = accounts ?? [];
    if (!accountTypeFilter) return all;
    return all.filter((a) => a.type === accountTypeFilter);
  }, [accounts, accountTypeFilter]);

  const accountTypes = useMemo(() => {
    const set = new Set((accounts ?? []).map((a) => a.type));
    return (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).filter((t) => set.has(t));
  }, [accounts]);

  // Donut slices from positive-balance accounts — use each account's stored colour
  const donutSlices = positiveAccounts.map((a) => ({
    value: a.current_balance ?? 0,
    color: a.color || "#6366f1",
    label: a.name,
  }));

  const donutTotal = donutSlices.reduce((s, sl) => s + sl.value, 0);
  const hoveredSlice = donutHover !== null ? donutSlices[donutHover] : null;

  // Account lookup for TxnRow
  const accountMap = new Map(
    (accounts ?? []).map((a) => [a.id, a])
  );

  return (
    <>
      {summary && summary.missing_rates.length > 0 && (
        <Link to="/settings" className={styles.rateBanner}>
          <span>
            ⚠ Net worth may be inaccurate — {summary.missing_rates.join(", ")}{" "}
            {summary.missing_rates.length > 1 ? "have" : "has"} no exchange rate
            and {summary.missing_rates.length > 1 ? "are" : "is"} converted at 1:1.
          </span>
          <span className={styles.rateBannerCta}>Set rates →</span>
        </Link>
      )}
      <div className={styles.grid}>
      {/* ── Left column ──────────────────────────────────── */}
      <div className={styles.left}>
        {/* 1. Net-worth hero */}
        <div className={styles.card}>
          <div className={styles.heroHeader}>
            <span className={styles.microLabel}>ACCESSIBLE NET WORTH</span>
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
              {pctChange != null && (
                <>
                  <span
                    className={styles.deltaPill}
                    style={{
                      background: `color-mix(in oklab, ${pctColor}, transparent 86%)`,
                      color: pctColor,
                    }}
                    title={`Net worth change over the ${range} period`}
                    aria-label={`Net worth ${pctUp ? "up" : "down"} ${Math.abs(pctChange).toFixed(1)} percent over ${range}`}
                  >
                    {pctUp ? "▲" : "▼"} {Math.abs(pctChange).toFixed(1)}%
                  </span>
                  <span className={styles.metaMute}>{range}</span>
                </>
              )}
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
        <div className={`${styles.statRow} ${setAside !== 0 ? styles.statRowFour : ""}`}>
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
          {setAside !== 0 && (
            <StatCard label="Set aside" value={fmt(setAside, currency)} />
          )}
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
            <StackControls
              variant={stackVariant}
              onVariantChange={setStackVariant}
              typeOptions={accountTypes.map((t) => ({ key: t, label: ACCOUNT_TYPE_LABELS[t] }))}
              typeValue={accountTypeFilter}
              onTypeChange={(v) => setAccountTypeFilter(v as AccountType | "")}
            />
          </div>
          <CardStack
            accounts={stackAccounts}
            variant={stackVariant}
            height={290}
          />
        </div>

        {/* 4. Recent activity */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Recent activity</div>
            <button className={styles.addPill} onClick={() => setShowTxnModal(true)}>
              + Add transaction
            </button>
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
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Goals progress</div>
            <button className={styles.addPill} onClick={() => setShowGoalModal(true)}>
              + Add goal
            </button>
          </div>
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

      {showTxnModal && (
        <AddModal
          accountId={accounts?.[0]?.id ?? null}
          onClose={() => setShowTxnModal(false)}
        />
      )}
      {showGoalModal && <AddGoalModal onClose={() => setShowGoalModal(false)} />}
      </div>
    </>
  );
}
