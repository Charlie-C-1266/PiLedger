import styles from "./Donut.module.css";

interface Slice {
  value: number;
  color: string;
  label: string;
}

interface Props {
  slices: Slice[];
  size?: number;
  thickness?: number;
  gap?: number;
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
  center?: React.ReactNode;
  ariaLabel?: string;
}

export default function Donut({
  slices,
  size = 200,
  thickness = 26,
  gap = 3,
  hoverIdx,
  onHover,
  center,
  ariaLabel,
}: Props) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return null;

  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapLen = (gap / 360) * circumference;

  const pct = (v: number) => Math.round((v / total) * 100);

  // The whole chart is exposed to assistive tech as a single labelled image:
  // `role="img"` makes the arcs presentational (so they can't be
  // focusable-but-silent, the bug this replaced), and the keyboard/AT path is
  // the legend the consumer renders alongside. The arcs keep mouse/pen hover
  // purely as a visual enhancement — touch and keyboard users drive the
  // highlight from the legend.
  const chartLabel =
    ariaLabel ??
    `Distribution across ${slices.length} segments: ` +
      slices.map((sl) => `${sl.label} ${pct(sl.value)}%`).join(", ");

  let offset = 0;
  const arcs = slices.map((sl, i) => {
    const frac = sl.value / total;
    const len = frac * circumference - gapLen;
    const dashOffset = -offset + circumference / 4;
    offset += frac * circumference;
    const dimmed = hoverIdx !== null && hoverIdx !== i;
    return (
      <circle
        key={i}
        className={styles.segment}
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={sl.color}
        strokeWidth={thickness}
        strokeDasharray={`${Math.max(len, 0)} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        opacity={dimmed ? 0.25 : 1}
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;
          onHover(i);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          onHover(null);
        }}
      />
    );
  });

  return (
    <div className={styles.wrap} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={chartLabel}
      >
        {arcs}
      </svg>
      {center && <div className={styles.center}>{center}</div>}
    </div>
  );
}
