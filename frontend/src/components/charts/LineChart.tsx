import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useTheme } from "../../theme/useTheme";
import { fmtShort } from "../../lib/currency";

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
          if (onHover && state && typeof state.activeTooltipIndex === "number") {
            onHover(data[state.activeTooltipIndex] ?? null);
          }
        }}
        onMouseLeave={() => onHover?.(null)}
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
          content={() => null}
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
