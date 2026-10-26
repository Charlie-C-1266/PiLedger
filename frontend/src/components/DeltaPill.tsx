import type { ReactNode } from "react";
import styles from "./DeltaPill.module.css";

interface Props {
  /** Up is money in (or a rise), down is money out (or a fall). The colour
   *  repeats the sign the caller already put in `children`; it never replaces it. */
  direction: "up" | "down";
  /** The formatted, signed change, e.g. "+£120.00" or "▼ 2.4%". */
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
}

/**
 * A signed change in a pill beside a headline figure. Follow it with a muted
 * "vs …" line so the comparison is spelled out.
 */
export default function DeltaPill({ direction, children, title, ...rest }: Props) {
  return (
    <span
      className={`${styles.pill} ${direction === "up" ? styles.up : styles.down}`}
      title={title}
      aria-label={rest["aria-label"]}
      data-direction={direction}
    >
      {children}
    </span>
  );
}
