import { useState } from "react";
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
  // Sticky highlight set by a tap/click/keyboard activation. Hover (mouse/pen)
  // reverts to this when the pointer leaves, so a tapped slice stays lit.
  const [tappedIdx, setTappedIdx] = useState<number | null>(null);

  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return null;

  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapLen = (gap / 360) * circumference;

  const pct = (v: number) => Math.round((v / total) * 100);

  function toggleTap(i: number) {
    const next = tappedIdx === i ? null : i;
    setTappedIdx(next);
    onHover(next);
  }

  function clearTap() {
    if (tappedIdx !== null) {
      setTappedIdx(null);
      onHover(null);
    }
  }

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
        role="button"
        tabIndex={0}
        aria-label={`${sl.label}, ${pct(sl.value)}%`}
        aria-pressed={tappedIdx === i}
        onPointerEnter={(e) => {
          // Touch pointers are handled by the click toggle; otherwise a tap
          // would highlight then immediately clear on lift (pointerleave).
          if (e.pointerType === "touch") return;
          onHover(i);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          onHover(tappedIdx);
        }}
        onClick={(e) => {
          e.stopPropagation();
          toggleTap(i);
        }}
        onFocus={() => onHover(i)}
        onBlur={() => onHover(tappedIdx)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleTap(i);
          }
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
        onClick={clearTap}
      >
        {arcs}
      </svg>
      {center && <div className={styles.center}>{center}</div>}
    </div>
  );
}
