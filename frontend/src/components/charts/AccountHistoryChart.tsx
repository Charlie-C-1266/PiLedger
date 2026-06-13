import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  type TooltipContentProps,
} from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { useTheme } from "../../theme/useTheme";
import type { ThemeTokens } from "../../theme/tokens";
import { fmt, fmtShort } from "../../lib/currency";
import type { AccountHistory } from "../../types";
import { buildHistoryRows, type HistorySeries } from "./accountHistory";
import styles from "./AccountHistoryChart.module.css";

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ChartTooltip({
  active,
  payload,
  label,
  theme,
  series,
}: TooltipContentProps<ValueType, NameType> & {
  theme: ThemeTokens;
  series: HistorySeries[];
}) {
  if (!active || !payload?.length) return null;
  const currencyByKey = new Map(series.map((s) => [s.key, s.currency]));
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.rule}`,
        borderRadius: 10,
        boxShadow: theme.shadowLg,
        padding: "8px 12px",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          font: '600 12px/1.2 "Plus Jakarta Sans", sans-serif',
          color: theme.text,
          marginBottom: 4,
        }}
      >
        {typeof label === "string" ? formatFullDate(label) : label}
      </div>
      {payload.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            font: '500 11px/1.4 "Plus Jakarta Sans", sans-serif',
            color: theme.textMute,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color,
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{p.name}</span>
          <span style={{ color: theme.text }}>
            {typeof p.value === "number"
              ? fmt(p.value, currencyByKey.get(String(p.dataKey)) ?? "GBP")
              : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  accounts: AccountHistory[];
  /** Base currency for the Y-axis ticks (each line's tooltip uses its own). */
  currency?: string;
  height?: number;
}

/**
 * Step-line chart of every account's balance over time — one coloured line per
 * account. Balances are not currency-converted, so the Y axis is only a rough
 * guide in the base currency while each line's tooltip shows its own currency.
 */
export default function AccountHistoryChart({
  accounts,
  currency = "GBP",
  height = 260,
}: Props) {
  const { theme } = useTheme();
  const { rows, series } = buildHistoryRows(accounts);

  if (series.length === 0 || rows.length < 2) {
    return (
      <div className={styles.empty}>
        Not enough balance history yet — record a balance or two to see the
        trend.
      </div>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={theme.rule} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
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
            content={(props) => (
              <ChartTooltip {...props} theme={theme} series={series} />
            )}
            cursor={{ stroke: theme.textMute, strokeDasharray: "4 4" }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="stepAfter"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.2}
              dot={false}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {/* Accessible, keyboard-reachable legend mapping colour → account. */}
      <ul className={styles.legend} aria-label="Accounts in this chart">
        {series.map((s) => (
          <li key={s.key} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: s.color }} />
            <span>{s.name}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
