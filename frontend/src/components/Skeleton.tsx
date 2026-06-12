import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

interface Props {
  /** CSS width (number → px). Defaults to 100%. */
  width?: number | string;
  /** CSS height (number → px). */
  height?: number | string;
  /** CSS border-radius (number → px). */
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A placeholder shimmer block shown while data loads, so the dashboard reserves
 * the real content's space instead of flashing misleading £0.00 / 0% values. The
 * shimmer animation is disabled under `prefers-reduced-motion`. Decorative, so
 * it is hidden from assistive tech (`aria-hidden`).
 */
export default function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className,
  style,
}: Props) {
  return (
    <span
      className={`${styles.skeleton}${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
      data-testid="skeleton"
    />
  );
}
