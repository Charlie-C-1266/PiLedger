import { useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useOccurrences, useSubscriptions } from "../hooks/useSubscriptions";
import { useAccounts } from "../hooks/useAccounts";
import {
  closedPostingAccount,
  matchesScheduledFilter,
  type ScheduledFilter,
} from "../lib/scheduled";
import Modal from "./Modal";
import ScheduledAmount, {
  AutoBadge,
  ClosedAccountWarning,
  TransferMark,
} from "./ScheduledAmount";
import { CheckIcon } from "./icons";
import type { Subscription, SubscriptionOccurrence } from "../types";
import styles from "../screens/Subscriptions.module.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const GRID_CELLS = 42; // 6 weeks × 7 days
const MAX_DOTS = 3;

/** Local-time `YYYY-MM-DD` key — never via toISOString(), which would shift the
 * day across the UTC boundary. */
function isoKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The cell's accessible name: the day, then how many items fall on it and
 * how many of those are already posted or skipped. */
function cellLabel(date: Date, occ: SubscriptionOccurrence[]): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (!occ.length) return day;
  const parts = [`${occ.length} scheduled item${occ.length !== 1 ? "s" : ""}`];
  for (const status of ["posted", "skipped"] as const) {
    const n = occ.filter((o) => o.status === status).length;
    if (n) parts.push(`${n} ${status}`);
  }
  return `${day}, ${parts.join(", ")}`;
}

/** One occurrence in a day cell: a dot while it's still to come, a tick once
 * it's posted (done), and a faded hollow ring when it was skipped. */
function OccurrenceDot({ occ }: { occ: SubscriptionOccurrence }) {
  const tint = occ.color || undefined;
  if (occ.status === "posted") {
    return (
      <CheckIcon
        className={styles.dotPosted}
        style={tint ? { color: tint } : undefined}
        strokeWidth={3}
        aria-hidden="true"
      />
    );
  }
  if (occ.status === "skipped") {
    return (
      <span
        className={`${styles.dot} ${styles.dotSkipped}`}
        style={tint ? { borderColor: tint } : undefined}
      />
    );
  }
  return (
    <span className={styles.dot} style={tint ? { background: tint } : undefined} />
  );
}

/** What the day popover says about an occurrence under its name: whether it's
 * been posted or skipped, or — while it's still to come — that its automatic
 * item can't post because an account is closed. */
function OccurrenceStatus({
  occ,
  sub,
  closedName,
}: {
  occ: SubscriptionOccurrence;
  sub: Subscription | undefined;
  closedName: string | null;
}) {
  if (occ.status === "posted") {
    return (
      <span className={styles.statusPosted}>
        <CheckIcon aria-hidden="true" />
        Posted
      </span>
    );
  }
  if (occ.status === "skipped") {
    return <span className={styles.statusSkipped}>Skipped</span>;
  }
  if (sub?.auto_post && closedName) {
    return <ClosedAccountWarning name={closedName} />;
  }
  return null;
}

interface Props {
  currency: string;
  /** Show only the occurrences of items that pass this filter. */
  filter?: ScheduledFilter;
}

/**
 * Hand-built month grid (no date-library dependency). It only *displays* dates —
 * the recurrence expansion is done server-side by `useOccurrences`, so the grid
 * is a pure group-by-date lookup keyed on `YYYY-MM-DD`, after dropping anything
 * the screen's filter hides. The 6×7 layout is a
 * roving-tabindex `grid` with arrow-key navigation.
 */
export default function SubscriptionsCalendar({ currency, filter }: Props) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [focusIdx, setFocusIdx] = useState(0);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // Grid spans 42 cells starting on the Monday on/before the 1st, so leading
  // and trailing days of adjacent months are shown (and dotted) too.
  const firstOfMonth = new Date(year, month, 1);
  const leadingOffset = (firstOfMonth.getDay() + 6) % 7; // Mon-start
  const gridStart = new Date(year, month, 1 - leadingOffset);

  const cells = useMemo(() => {
    return Array.from({ length: GRID_CELLS }, (_, i) => {
      const d = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i
      );
      return {
        date: d,
        key: isoKey(d),
        inMonth: d.getMonth() === month,
        isToday: isoKey(d) === isoKey(today),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const windowStart = cells[0].key;
  const windowEnd = cells[GRID_CELLS - 1].key;
  const { data: occurrences } = useOccurrences(windowStart, windowEnd);
  // Occurrences carry only the item's id; the item itself says whether it's
  // automatic, and the accounts whether it has anywhere open to post.
  const { data: subscriptions } = useSubscriptions();
  const { data: accounts } = useAccounts();
  const subById = useMemo(
    () => new Map((subscriptions ?? []).map((s) => [s.id, s])),
    [subscriptions]
  );

  const byDate = useMemo(() => {
    const map: Record<string, SubscriptionOccurrence[]> = {};
    for (const o of occurrences ?? []) {
      if (filter && !matchesScheduledFilter(o, filter)) continue;
      (map[o.date] ??= []).push(o);
    }
    return map;
  }, [occurrences, filter]);

  const step = (delta: number) =>
    setViewMonth(new Date(year, month + delta, 1));
  const goToday = () =>
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  const focusCell = (idx: number) => {
    const clamped = Math.max(0, Math.min(GRID_CELLS - 1, idx));
    setFocusIdx(clamped);
    cellRefs.current[clamped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number, key: string) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusCell(idx + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(idx - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(idx + 7);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(idx - 7);
        break;
      case "Enter":
      case " ":
        if (byDate[key]?.length) {
          e.preventDefault();
          setOpenDay(key);
        }
        break;
    }
  };

  const dayOccurrences = openDay ? (byDate[openDay] ?? []) : [];

  return (
    <div className={styles.calWrap}>
      <div className={styles.calHeader}>
        <div className={styles.calTitle}>
          {MONTHS[month]} {year}
        </div>
        <div className={styles.calNav}>
          <button className={styles.calBtn} onClick={() => step(-1)} aria-label="Previous month">
            ‹ Prev
          </button>
          <button className={styles.calBtn} onClick={goToday}>
            Today
          </button>
          <button className={styles.calBtn} onClick={() => step(1)} aria-label="Next month">
            Next ›
          </button>
        </div>
      </div>

      <div className={styles.weekHead} aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <div key={w} className={styles.weekday}>
            {w}
          </div>
        ))}
      </div>

      <div className={styles.grid} role="grid" aria-label={`${MONTHS[month]} ${year}`}>
        {cells.map((cell, i) => {
          const occ = byDate[cell.key] ?? [];
          const hasOcc = occ.length > 0;
          const label = cellLabel(cell.date, occ);
          return (
            <div
              key={cell.key}
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              role="gridcell"
              aria-label={label}
              tabIndex={i === focusIdx ? 0 : -1}
              className={`${styles.cell} ${cell.inMonth ? "" : styles.cellOther} ${
                cell.isToday ? styles.cellToday : ""
              } ${hasOcc ? styles.cellClickable : ""}`}
              onClick={() => hasOcc && setOpenDay(cell.key)}
              onKeyDown={(e) => onKeyDown(e, i, cell.key)}
              onFocus={() => setFocusIdx(i)}
            >
              <span className={styles.dayNum}>{cell.date.getDate()}</span>
              {hasOcc && (
                <div className={styles.dots}>
                  {occ.slice(0, MAX_DOTS).map((o, j) => (
                    <OccurrenceDot key={j} occ={o} />
                  ))}
                  {occ.length > MAX_DOTS && (
                    <span className={styles.moreBadge}>+{occ.length - MAX_DOTS}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {openDay && (
          <Modal onClose={() => setOpenDay(null)} label="Scheduled items due">
            <div className={styles.popoverTitle}>Due {openDay}</div>
            {dayOccurrences.map((o, i) => {
              const sub = subById.get(o.subscription_id);
              const closed = closedPostingAccount(o, accounts);
              return (
                <div
                  key={i}
                  className={`${styles.popoverRow} ${
                    o.status === "skipped" ? styles.popoverSkipped : ""
                  }`}
                >
                  <div className={styles.popoverInfo}>
                    <span className={styles.popoverName}>
                      <span
                        className={styles.popoverDot}
                        style={o.color ? { background: o.color } : { background: "var(--pl-accent)" }}
                      />
                      {o.kind === "transfer" && <TransferMark />}
                      {o.name}
                      {sub?.auto_post && <AutoBadge />}
                    </span>
                    <OccurrenceStatus
                      occ={o}
                      sub={sub}
                      closedName={closed?.name ?? null}
                    />
                  </div>
                  <ScheduledAmount
                    kind={o.kind}
                    amount={o.amount}
                    currency={currency}
                    className={styles.popoverAmount}
                  />
                </div>
              );
            })}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
