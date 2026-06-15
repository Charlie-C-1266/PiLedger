import { useEffect, type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import styles from "./Modal.module.css";

interface Props {
  onClose: () => void;
  children: ReactNode;
  /** "wide" widens the card for chart/detail modals (e.g. projections). */
  size?: "default" | "wide";
  /** Accessible name, for dialogs without an otherwise-wired heading. */
  label?: string;
}

/**
 * Shared modal shell: a blurred backdrop and a centred card that appears in
 * place with a quick fade-and-scale (and fades back out on close). Place inside
 * an <AnimatePresence> so the exit plays. Honours prefers-reduced-motion by
 * dropping the scale to a plain fade.
 */
export default function Modal({
  onClose,
  children,
  size = "default",
  label,
}: Props) {
  const reduce = useReducedMotion();

  // Escape closes the modal — a dismissal affordance the hand-rolled modals
  // never had (only backdrop click / Cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const backdropVariants: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.18 } },
    exit: { opacity: 0, transition: { duration: 0.14 } },
  };

  // Centred entrance: fade + a subtle scale-up from the middle. Reduced motion
  // drops the scale so it's a plain crossfade.
  const cardVariants: Variants = reduce
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.12 } },
      }
    : {
        hidden: { opacity: 0, scale: 0.96 },
        show: {
          opacity: 1,
          scale: 1,
          transition: { duration: 0.18, ease: "easeOut" },
        },
        // Exit is quicker than the entrance so dismissal feels responsive.
        exit: {
          opacity: 0,
          scale: 0.98,
          transition: { duration: 0.12, ease: "easeIn" },
        },
      };

  return (
    <motion.div
      className={styles.backdrop}
      onClick={onClose}
      variants={backdropVariants}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.div
        className={`${styles.card} ${size === "wide" ? styles.wide : ""}`}
        onClick={(e) => e.stopPropagation()}
        variants={cardVariants}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
