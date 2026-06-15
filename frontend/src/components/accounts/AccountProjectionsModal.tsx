import { useMemo, useState } from "react";
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
import Modal from "../Modal";
import { useProjections } from "../../hooks/useProjections";
import { fmt, fmtShort } from "../../lib/currency";
import {
  buildProjectionRows,
  type ProjectionSeries,
} from "./accountProjections";
import styles from "./AccountProjectionsModal.module.css";

interface Props {
  /** Base currency, used only for the Y-axis ticks; each line and card shows
   * its own account currency. */
  currency: string;
  onClose: () => void;
}

function formatMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mon = d.toLocaleDateString("en-GB", { month: "short" });
  return `${mon} '${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

function ChartTooltip({
  active,
  payload,
  label,
  theme,
  series,
}: TooltipContentProps<ValueType, NameType> & {
  theme: ThemeTokens;
  series: ProjectionSeries[];
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
        {typeof label === "string" ? formatMonth(label) : label}
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

/**
 * Savings-account projections: a chart of each account's compound-interest
 * trajectory plus per-account 1/2/5-year milestone cards, with colour-coded
 * chips to focus on specific accounts. Data comes from the server's
 * `/api/projections` (figures stay in each account's own currency). Mirrors the
 * goal-projection modal's shape, but at the account level.
 */
export default function AccountProjectionsModal({ currency, onClose }: Props) {
  const { theme } = useTheme();
  const { data: projections, isPending } = useProjections();

  // null = "all shown"; a Set once the user has toggled a chip.
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const all = useMemo(() => projections ?? [], [projections]);
  const isOn = (id: number) => selected === null || selected.has(id);
  const shown = all.filter((p) => isOn(p.id));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev ?? all.map((p) => p.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { rows, series } = useMemo(() => buildProjectionRows(shown), [shown]);

  return (
    <Modal onClose={onClose} size="wide">
        <div className={styles.head}>
          <div>
            <h2 className={styles.title}>Savings projections</h2>
            <p className={styles.sub}>
              Projected balance with monthly compound interest, per savings
              account. Milestones are at 1, 2 and 5 years.
            </p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {isPending ? (
          <div className={styles.empty}>Loading projections…</div>
        ) : all.length === 0 ? (
          <div className={styles.empty}>
            Add a savings account with an interest rate to see its projected
            growth.
          </div>
        ) : (
          <>
            <div className={styles.chips}>
              {all.map((p) => {
                const on = isOn(p.id);
                return (
                  <button
                    key={p.id}
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => toggle(p.id)}
                    style={on ? { borderColor: p.color } : undefined}
                    aria-pressed={on}
                  >
                    <span
                      className={styles.dot}
                      style={{ background: on ? p.color : "var(--pl-text-mute)" }}
                    />
                    {p.name}
                  </button>
                );
              })}
            </div>

            {/* Per-account 1/2/5-year milestone cards (own currency). */}
            <div className={styles.cards}>
              {shown.map((p) => (
                <div key={p.id} className={styles.summaryCard}>
                  <div className={styles.cardHead}>
                    <span className={styles.cardDot} style={{ background: p.color }} />
                    <span className={styles.cardName}>{p.name}</span>
                    <span className={styles.cardRate}>{p.interest_rate}% p.a.</span>
                  </div>
                  <div className={styles.milestones}>
                    {(["1yr", "2yr", "5yr"] as const).map((k) => (
                      <div key={k} className={styles.milestone}>
                        <span className={styles.milestoneLabel}>
                          {k.replace("yr", " yr")}
                        </span>
                        <span className={styles.milestoneValue}>
                          {fmt(p[k], p.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.chart}>
              {shown.length === 0 ? (
                <div className={styles.empty}>Select an account to plot it.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={rows}
                    margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid stroke={theme.rule} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatMonth}
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
                        type="monotone"
                        dataKey={s.key}
                        name={s.name}
                        stroke={s.color}
                        strokeWidth={2.2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
    </Modal>
  );
}
