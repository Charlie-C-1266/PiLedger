import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon } from "../icons";
import { ToastContext, type Toast, type ToastVariant } from "./ToastContext";
import styles from "./Toast.module.css";

// Errors linger longer than confirmations — they carry information the user may
// need to read, whereas a success is just reassurance.
const DURATION: Record<ToastVariant, number> = {
  success: 3500,
  error: 6000,
};

function ErrorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="12" r="9" strokeWidth="2" />
      <path d="M12 7v6" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * App-wide toast host. Mount it once near the root (above the router and the
 * modal layer) so a toast fired as a modal closes outlives the modal that
 * triggered it. Exposes `success`/`error` via {@link useToast}; each toast
 * auto-dismisses after {@link DURATION} and can be closed early.
 *
 * `durations` overrides the per-variant lifetimes — mainly a testing seam so a
 * suite can drive the auto-dismiss without waiting seconds of wall-clock.
 */
export function ToastProvider({
  children,
  durations = DURATION,
}: {
  children: ReactNode;
  durations?: Record<ToastVariant, number>;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduce = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), durations[variant])
      );
    },
    [dismiss, durations]
  );

  const value = useMemo(
    () => ({
      success: (message: string) => push(message, "success"),
      error: (message: string) => push(message, "error"),
      dismiss,
    }),
    [push, dismiss]
  );

  // Slide up from below and fade; reduced motion drops the movement.
  const initial = reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 };
  const animate = reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const exit = reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-atomic="false">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              className={`${styles.toast} ${styles[t.variant]}`}
              role={t.variant === "error" ? "alert" : "status"}
              initial={initial}
              animate={animate}
              exit={exit}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <span className={styles.icon} aria-hidden="true">
                {t.variant === "success" ? (
                  <CheckIcon width={18} height={18} />
                ) : (
                  <ErrorIcon width={18} height={18} />
                )}
              </span>
              <span className={styles.message}>{t.message}</span>
              <button
                type="button"
                className={styles.close}
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
