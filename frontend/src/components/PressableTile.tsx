import { useLongPress } from "../hooks/useLongPress";
import styles from "./PressableTile.module.css";

interface Props {
  onActivate: () => void;
  children: React.ReactNode;
}

/**
 * Wraps an account tile with the same edit gesture as a transaction row:
 * immediate click on desktop, deliberate long-press on touch. Suppresses the
 * double-tap-to-zoom and text-selection that a plain tap on the large tile
 * would otherwise trigger on mobile.
 */
export default function PressableTile({ onActivate, children }: Props) {
  const { pressing, handlers } = useLongPress(onActivate);

  return (
    <div className={`${styles.tile} ${pressing ? styles.pressing : ""}`} {...handlers}>
      {children}
    </div>
  );
}
