import { markFontSize, markForeground } from "../lib/institutions";
import type { Institution } from "../lib/institutions";
import styles from "./InstitutionMark.module.css";

interface Props {
  /** A resolved catalogue entry — see `resolveInstitution`. */
  institution: Pick<Institution, "name" | "color" | "mark">;
  /** Badge edge length in px. */
  size?: number;
  className?: string;
}

/**
 * A brand-coloured monogram standing in for an institution's logo.
 *
 * Deliberately not the real logo: those are trademarked artwork we'd be
 * redistributing. The brand colour carries most of the recognition anyway, and
 * a monogram scales to any size without an asset pipeline or a network round
 * trip — which matters for an app that runs offline on a Pi.
 */
export default function InstitutionMark({
  institution,
  size = 22,
  className,
}: Props) {
  const { name, color, mark } = institution;

  return (
    <span
      className={`${styles.mark} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.28)),
        background: color,
        color: markForeground(color),
        fontSize: markFontSize(mark, size),
      }}
      role="img"
      aria-label={name}
      title={name}
    >
      {mark}
    </span>
  );
}
