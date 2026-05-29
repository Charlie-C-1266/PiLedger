import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  type TooltipContentProps,
} from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { useTheme } from "../../theme/useTheme";
import type { ThemeTokens } from "../../theme/tokens";
import { fmt, fmtShort } from "../../lib/currency";

interface Point {
  date: string;
  value: number;
}

interface Props {
  data: Point[];
  height?: number;
  onHover?: (point: Point | null) => void;
  currency?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// recharts v3 reports the active index as a string (TooltipIndex = string | null),
// so the old `typeof === "number"` guard never matched and hover stopped firing.
// Coerce defensively and bounds-check against the data length.
function activePointIndex(
  raw: number | string | null | undefined,
  len: number
): number | null {
  if (raw == null) return null;
  const i = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(i) && i >= 0 && i < len ? i : null;
}

function ChartTooltip({
  active,
  payload,
  label,
  theme,
  currency,
}: TooltipContentProps<ValueType, NameType> & {
  theme: ThemeTokens;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
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
        }}
      >
        {typeof label === "string" ? formatDate(label) : label}
      </div>
      <div
        style={{
          font: '500 11px/1.3 "Plus Jakarta Sans", sans-serif',
          color: theme.textMute,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {typeof value === "number" ? fmt(value, currency) : "—"}
      </div>
    </div>
  );
}

export default function LineChart({
  data,
  height = 240,
  onHover,
  currency = "GBP",
}: Props) {
  const { mode, theme } = useTheme();
  const fillOpacity = mode === "light" ? 0.22 : 0.32;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
        onMouseMove={(state) => {
          if (!onHover) return;
          const i = activePointIndex(state?.activeTooltipIndex, data.length);
          onHover(i === null ? null : data[i]);
        }}
        onMouseLeave={() => onHover?.(null)}
        onTouchMove={(state) => {
          if (!onHover) return;
          const i = activePointIndex(state?.activeTooltipIndex, data.length);
          onHover(i === null ? null : data[i]);
        }}
        onTouchEnd={() => onHover?.(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={fillOpacity} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={{ fill: theme.textMute, fontSize: 11 }}
          tickFormatter={(v: number) => fmtShort(v, currency)}
          width={50}
          tickCount={4}
        />
        <Tooltip
          content={(props) => (
            <ChartTooltip {...props} theme={theme} currency={currency} />
          )}
          cursor={{
            stroke: theme.textMute,
            strokeDasharray: "4 4",
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={theme.accent}
          strokeWidth={2.2}
          fill="url(#areaFill)"
          dot={false}
          activeDot={{
            r: 4,
            fill: theme.accent,
            stroke: theme.surface,
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
