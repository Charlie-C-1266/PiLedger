import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useSummary } from "../hooks/useSummary";
import { fmt } from "../lib/currency";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import SegmentedControl from "../components/SegmentedControl";
import SubscriptionsCalendar from "../components/SubscriptionsCalendar";
import AddSubscriptionModal from "../components/AddSubscriptionModal";
import type { Subscription } from "../types";
import styles from "./Subscriptions.module.css";

type View = "list" | "calendar";

/** Human "due in N days" label + the pill style class for a subscription. */
function dueLabel(sub: Subscription): { text: string; cls: string } {
  if (!sub.active) return { text: "Paused", cls: styles.duePillNone };
  if (!sub.next_due_date) return { text: "No upcoming", cls: styles.duePillNone };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(sub.next_due_date + "T00:00:00");
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const soon = days <= 7;
  let text: string;
  if (days <= 0) text = "Due today";
  else if (days === 1) text = "Due tomorrow";
  else text = `Due in ${days} days`;
  return { text, cls: soon ? styles.duePillSoon : styles.duePillOk };
}

function SubscriptionRow({
  sub,
  currency,
  onEdit,
}: {
  sub: Subscription;
  currency: string;
  onEdit: (s: Subscription) => void;
}) {
  const due = dueLabel(sub);
  return (
    <div
      className={styles.card}
      style={sub.color ? { borderLeftColor: sub.color } : undefined}
      onClick={() => onEdit(sub)}
    >
      <div className={styles.cardLeft}>
        <span className={styles.name}>{sub.name}</span>
        <span className={styles.meta}>
          <span className={styles.freqBadge}>{sub.frequency}</span>
          {sub.account_name && <span>{sub.account_name}</span>}
          {sub.category && <span>{sub.category}</span>}
        </span>
      </div>
      <div className={styles.cardRight}>
        <span className={styles.amount}>{fmt(sub.amount, currency)}</span>
        <span className={`${styles.duePill} ${due.cls}`}>{due.text}</span>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const { data: subscriptions } = useSubscriptions();
  const { data: summary } = useSummary();
  const currency = summary?.base_currency ?? "GBP";
  const [view, setView] = useState<View>("list");
  const [showAdd, setShowAdd] = useState(false);
  const [editSub, setEditSub] = useState<Subscription | null>(null);

  return (
    <PageStagger className={styles.page}>
      <StaggerItem className={styles.header}>
        <h1 className={styles.title}>Subscriptions</h1>
        <div className={styles.headerActions}>
          <SegmentedControl<View>
            options={[
              { value: "list", label: "List" },
              { value: "calendar", label: "Calendar" },
            ]}
            value={view}
            onChange={setView}
            ariaLabel="Subscription view"
          />
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            + Add subscription
          </button>
        </div>
      </StaggerItem>

      <StaggerItem>
        {view === "list" ? (
          <div className={styles.list}>
            {(subscriptions ?? []).map((s) => (
              <SubscriptionRow
                key={s.id}
                sub={s}
                currency={currency}
                onEdit={setEditSub}
              />
            ))}
            {subscriptions?.length === 0 && (
              <div className={styles.empty}>
                No subscriptions yet. Add one to track its renewal dates.
              </div>
            )}
          </div>
        ) : (
          <SubscriptionsCalendar currency={currency} />
        )}
      </StaggerItem>

      <AnimatePresence>
        {showAdd && (
          <AddSubscriptionModal key="add" onClose={() => setShowAdd(false)} />
        )}
        {editSub && (
          <AddSubscriptionModal
            key="edit"
            subscription={editSub}
            onClose={() => setEditSub(null)}
          />
        )}
      </AnimatePresence>
    </PageStagger>
  );
}
