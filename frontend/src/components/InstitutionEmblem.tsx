import { markFontSize, markForeground } from "../lib/institutions";
import type { Institution } from "../lib/institutions";
import styles from "./InstitutionEmblem.module.css";

interface Props {
  /** A resolved catalogue entry — see `resolveInstitution`. */
  institution: Pick<Institution, "name" | "color" | "mark">;
}

// Geometry in the 120×120 viewBox. The rings deliberately overrun the corner and
// are clipped by the tile, which is what made the decorative circles they replace
// read as card artwork rather than as a sticker.
const CX = 78;
const CY = 42;
const DISC_R = 22;
const RINGS = [
  { r: 52, opacity: 0.35 },
  { r: 36, opacity: 0.55 },
];

/**
 * An institution rendered as an account card's own artwork: brand-coloured rings
 * bleeding off the top-right corner, with a solid brand disc and the monogram at
 * their centre. Replaces the plain white circles on any card whose account has a
 * provider recorded.
 *
 * Each ring is drawn twice — a faint white understroke, then the brand colour
 * over it. Card colours are user-chosen and often *are* the brand colour, and a
 * Chase-blue ring on a Chase-blue card would otherwise vanish; the understroke
 * keeps the artwork present in that case, falling back to how the card looked
 * before. The disc carries a white edge for the same reason.
 */
export default function InstitutionEmblem({ institution }: Props) {
  const { name, color, mark } = institution;

  return (
    <svg
      className={styles.emblem}
      viewBox="0 0 120 120"
      role="img"
      aria-label={name}
    >
      {RINGS.map((ring) => (
        <g key={ring.r} fill="none" strokeWidth="1">
          <circle cx={CX} cy={CY} r={ring.r} stroke="rgba(255,255,255,0.18)" />
          <circle cx={CX} cy={CY} r={ring.r} stroke={color} strokeOpacity={ring.opacity} />
        </g>
      ))}
      <circle
        cx={CX}
        cy={CY}
        r={DISC_R}
        fill={color}
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="1.5"
      />
      <text
        x={CX}
        y={CY}
        fill={markForeground(color)}
        fontSize={markFontSize(mark, DISC_R * 2)}
        textAnchor="middle"
        dominantBaseline="central"
        className={styles.mark}
      >
        {mark}
      </text>
    </svg>
  );
}
