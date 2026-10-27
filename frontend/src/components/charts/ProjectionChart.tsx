import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from "recharts";
import { useTheme } from "../../theme/useTheme";
import { useMoney } from "../../privacy/useMoney";
import {
  dateTicks,
  dayLong,
  dayShort,
  dayWithWeekday,
  horizonLabel,
  lowPoint,
  monthEnds,
  rowKind,
  rowValue,
  valueAxis,
  type ChartSeries,
} from "../../screens/account/projectionModel";
import styles from "./ProjectionChart.module.css";

interface Props {
  series: ChartSeries;
  /** The selected horizon, in months: picks the date ticks and the label. */
  months: number;
  currency: string;
  /** Label the projection's low point (off for debt, where low means owing less). */
  showLow?: boolean;
}

// The plot area's offsets inside the chart, shared by Recharts (margins and
// axis sizes) and the overlay that draws the markers on top of it.
const MARGIN = { top: 22, right: 4, bottom: 0, left: 0 };
const Y_AXIS_WIDTH = 54;
const X_AXIS_HEIGHT = 24;
const PLOT_INSET = {
  top: MARGIN.top,
  left: MARGIN.left,
  right: MARGIN.right + Y_AXIS_WIDTH,
  bottom: MARGIN.bottom + X_AXIS_HEIGHT,
};

interface Active {
  index: number;
  /** Arrow keys also announce the value; a pointer only shows it. */
  fromKeyboard: boolean;
}

/**
 * An account's balance over time: a short stretch of actual history, a dotted
 * "Today" marker, then the projection dashed with half the fill up to the
 * chosen horizon. Recharts draws the lines and axes; an overlay on the same
 * plot area draws the markers, the end and low labels, the zero line and the
 * crosshair, so moving the crosshair never re-renders the chart.
 *
 * Hover (or drag on touch) and the arrow keys move the crosshair; a visually
 * hidden table lists the projected month-end balances.
 */
export default function ProjectionChart({ series, months, currency, showLow = true }: Props) {
  const { rows, todayIndex } = series;
  const { fmt, fmtShort, hidden } = useMoney();
  const { mode, theme } = useTheme();
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Active | null>(null);
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  // "£2.5k" on the axis and labels, whole pounds below a thousand ("£400").
  const compact = useCallback(
    (v: number) =>
      Math.abs(v) < 1000 ? fmt(v, currency, { decimals: 0 }) : fmtShort(v, currency),
    [fmt, fmtShort, currency],
  );

  const last = rows.length - 1;
  const axis = useMemo(() => valueAxis(rows.map(rowValue)), [rows]);
  const ticks = useMemo(() => dateTicks(rows, months), [rows, months]);
  const low = lowPoint(series);
  const fillOpacity = mode === "light" ? 0.22 : 0.32;

  // Overlay positions, as percentages of the plot area.
  const x = (index: number) => (last > 0 ? (index / last) * 100 : 0);
  const y = (value: number) => (1 - (value - axis.min) / (axis.max - axis.min)) * 100;

  const chart = useMemo(() => {
    const tickLabels = new Map(ticks.map((t) => [t.index, t.label]));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={MARGIN} accessibilityLayer={false}>
          <defs>
            <linearGradient id={`${gradientId}-actual`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${gradientId}-projected`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={fillOpacity / 2} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            type="number"
            dataKey="i"
            domain={[0, Math.max(last, 1)]}
            ticks={ticks.map((t) => t.index)}
            tickFormatter={(i: number) => tickLabels.get(i) ?? ""}
            axisLine={false}
            tickLine={false}
            height={X_AXIS_HEIGHT}
            minTickGap={16}
            tick={{ fill: theme.textMute, fontSize: 11 }}
          />
          <YAxis
            type="number"
            orientation="right"
            domain={[axis.min, axis.max]}
            ticks={axis.ticks}
            tickFormatter={(v: number) => (hidden ? "" : compact(v))}
            axisLine={false}
            tickLine={false}
            width={Y_AXIS_WIDTH}
            tick={{ fill: theme.textMute, fontSize: 11 }}
          />
          <Area
            type="linear"
            dataKey="actual"
            stroke={theme.accent}
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradientId}-actual)`}
            baseValue={axis.min}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Area
            type="linear"
            dataKey="projected"
            stroke={theme.accent}
            strokeWidth={2.2}
            strokeDasharray="6 5"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradientId}-projected)`}
            baseValue={axis.min}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }, [rows, last, axis, ticks, gradientId, theme, fillOpacity, hidden, compact]);

  const show = (index: number, fromKeyboard: boolean) =>
    setActive({ index: Math.max(0, Math.min(last, index)), fromKeyboard });

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    show(Math.round(frac * last), false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = Math.max(1, Math.round(rows.length / 40));
    const from = active?.index ?? todayIndex;
    if (e.key === "ArrowRight") show(active ? from + step : todayIndex, true);
    else if (e.key === "ArrowLeft") show(active ? from - step : todayIndex, true);
    else if (e.key === "Home") show(0, true);
    else if (e.key === "End") show(last, true);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const end = rows[last];
  const endY = y(rowValue(end));
  // Sit the end label above the line's last stretch, or below the dot when
  // that stretch runs along the top.
  const tailTop = Math.min(...rows.slice(Math.floor(rows.length * 0.82)).map((r) => y(rowValue(r))));
  const endLabelBelow = tailTop < 12;
  const lowShown = showLow && low !== todayIndex && low !== last;
  const crossesZero = axis.min < 0 && axis.max > 0;
  const current = active ? rows[active.index] : null;
  const currentText = current
    ? `${fmt(rowValue(current), currency)} · ${rowKind(active!.index, todayIndex)}`
    : "";

  return (
    <div className={styles.wrap}>
      <div
        className={styles.chart}
        tabIndex={0}
        role="group"
        aria-label={`Balance chart, ${horizonLabel(months).toLowerCase()}. Use left and right arrow keys to read values.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {chart}
        <div className={styles.plot} ref={plotRef} style={PLOT_INSET} aria-hidden="true">
          {crossesZero && (
            <div className={styles.zero} data-part="zero-line" style={{ top: `${y(0)}%` }} />
          )}
          <div className={styles.today} data-part="today" style={{ left: `${x(todayIndex)}%` }}>
            <span className={styles.todayLabel}>Today</span>
          </div>
          {lowShown && (
            <>
              <span
                className={styles.dot}
                style={{ left: `${x(low)}%`, top: `${y(rowValue(rows[low]))}%` }}
              />
              <span
                className={styles.lowLabel}
                data-part="low-label"
                data-below={y(rowValue(rows[low])) < 85}
                style={{ left: `${x(low)}%`, top: `${y(rowValue(rows[low]))}%` }}
              >
                Low {hidden ? "" : `${compact(rowValue(rows[low]))} · `}
                {dayShort(rows[low].date)}
              </span>
            </>
          )}
          <span className={styles.dot} style={{ left: `${x(last)}%`, top: `${endY}%` }} />
          {!hidden && (
            <span
              className={styles.endLabel}
              data-part="end-label"
              data-below={endLabelBelow}
              style={{ left: `${x(last)}%`, top: `${endLabelBelow ? endY : tailTop}%` }}
            >
              {fmt(rowValue(end), currency)}
            </span>
          )}
          {current && active && (
            <>
              <div className={styles.cursor} style={{ left: `${x(active.index)}%` }} />
              <span
                className={styles.dot}
                style={{ left: `${x(active.index)}%`, top: `${y(rowValue(current))}%` }}
              />
              <div
                className={styles.tip}
                data-flip={x(active.index) > 55}
                data-low={y(rowValue(current)) < 30}
                style={{ left: `${x(active.index)}%`, top: `${y(rowValue(current))}%` }}
              >
                <div className={styles.tipDate}>{dayWithWeekday(current.date)}</div>
                <div className={styles.tipValue}>{currentText}</div>
              </div>
            </>
          )}
        </div>
        <div className="sr-only" aria-live="polite">
          {current && active?.fromKeyboard ? `${dayWithWeekday(current.date)}: ${currentText}` : ""}
        </div>
      </div>
      <table className="sr-only">
        <caption>Projected month-end balances</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {monthEnds(series).map((r) => (
            <tr key={r.date}>
              <td>{dayLong(r.date)}</td>
              <td>{fmt(rowValue(r), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
