import { markForeground } from "../lib/institutions";
import type { Institution } from "../lib/institutions";
import styles from "./InstitutionMark.module.css";

interface Props {
  /** A resolved catalogue entry — see `resolveInstitution`. */
  institution: Pick<Institution, "name" | "color" | "mark">;
  /** Badge edge length in px. */
  size?: number;
  /** Draw a translucent light ring, so the mark separates from a coloured card. */
  ring?: boolean;
  className?: string;
}

// Longer monograms need proportionally smaller text to stay inside the badge.
// Indexed by mark length; anything longer than four characters uses the last.
const TEXT_SCALE = [0.5, 0.42, 0.33, 0.26];

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
  ring,
  className,
}: Props) {
  const { name, color, mark } = institution;
  const scale = TEXT_SCALE[Math.min(mark.length, TEXT_SCALE.length) - 1];

  return (
    <span
      className={`${styles.mark} ${ring ? styles.ring : ""} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.28)),
        background: color,
        color: markForeground(color),
        fontSize: Math.round(size * scale * 10) / 10,
      }}
      role="img"
      aria-label={name}
      title={name}
    >
      {mark}
    </span>
  );
}
