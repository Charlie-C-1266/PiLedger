import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { getSubscriptions } from "../../api/client";
import { useAccountProjection } from "../../hooks/useAccountProjection";
import { useOccurrenceActions } from "../../hooks/useOccurrenceActions";
import { useMoney } from "../../privacy/useMoney";
import { useToast } from "../../components/toast/useToast";
import AddSubscriptionModal from "../../components/AddSubscriptionModal";
import Skeleton from "../../components/Skeleton";
import TextLink from "../../components/TextLink";
import UpcomingActions from "../../components/accounts/UpcomingActions";
import UpcomingRow from "../../components/accounts/UpcomingRow";
import {
  UPCOMING_LIMIT,
  dayShort,
  isScheduled,
  nextOccurrence,
  signedAmount,
  upcoming,
} from "./projectionModel";
import type { Account, BalanceProjectionEvent, Subscription } from "../../types";
import styles from "../AccountPage.module.css";

const isDebt = (a: Pick<Account, "type">) => a.type === "loan" || a.type === "credit";

/**
 * The account page's Upcoming card: scheduled items (and projected interest)
 * over today and the next 30 days, each with the balance after it. A scheduled
 * row opens its actions — Post now, Skip this one, Edit schedule — and Post now
 * or Skip confirms with a toast that can Undo. Focus goes back to the list
 * (the same row, or the next one if it was just posted) whenever the dialog
 * closes or the list redraws under it.
 */
export default function UpcomingCard({ account }: { account: Account }) {
  const { fmt } = useMoney();
  const toast = useToast();
  const qc = useQueryClient();
  const projection = useAccountProjection(account.id, { enabled: !account.closed });
  const [acting, setActing] = useState<BalanceProjectionEvent | null>(null);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const card = useRef<HTMLElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const lastIndex = useRef(0);
  const refocusAfterRefresh = useRef(false);

  // The nearest scheduled row at or after `index` (else before it), or the
  // card's Manage link when none is left.
  const focusList = useCallback((index: number) => {
    const list = rows.current;
    const order = [...list.slice(index), ...list.slice(0, index).reverse()];
    const row = order.find((el) => el?.isConnected && el.getAttribute("role") === "button");
    (row ?? card.current?.querySelector<HTMLElement>("a"))?.focus();
  }, []);

  const settled = useCallback(() => {
    refocusAfterRefresh.current = true;
  }, []);
  const actions = useOccurrenceActions(account.name, settled);

  // After Post now, Skip or Undo the list redraws; if the focused row went with
  // it, put focus back on the row now in its place.
  useEffect(() => {
    if (!refocusAfterRefresh.current) return;
    refocusAfterRefresh.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) focusList(lastIndex.current);
  }, [projection.data, focusList]);

  if (account.closed) return null;

  const open = (event: BalanceProjectionEvent, index: number) => {
    lastIndex.current = index;
    setActing(event);
  };

  const close = () => {
    setActing(null);
    focusList(lastIndex.current);
  };

  const act = async (run: (e: BalanceProjectionEvent) => Promise<boolean>) => {
    if (!acting) return;
    if (await run(acting)) close();
  };

  const editSchedule = async () => {
    if (!acting) return;
    const sid = acting.subscription_id;
    setActing(null);
    try {
      const items = await qc.fetchQuery({ queryKey: ["subscriptions"], queryFn: getSubscriptions });
      const item = items.find((s) => s.id === sid);
      if (item) setEditing(item);
      else toast.error("Couldn't find that scheduled item.");
    } catch {
      toast.error("Couldn't open that scheduled item. Please try again.");
      focusList(lastIndex.current);
    }
  };

  const data = projection.data;
  const soon = data ? upcoming(data) : null;
  const scheduled = soon?.events.filter(isScheduled) ?? [];
  const shown = soon?.events.slice(0, UPCOMING_LIMIT) ?? [];
  const more = (soon?.events.length ?? 0) - shown.length;
  // Tint any "after" under the account's "Warn me below" amount (zero when
  // unset); debt balances are owed, so they never tint.
  const warn = isDebt(account) ? null : (account.low_balance_threshold ?? 0);

  let body;
  if (projection.isPending) {
    body = (
      <div aria-busy="true">
        <span className="sr-only">Loading upcoming transactions</span>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={40} radius={10} style={{ margin: "11px 0" }} />
        ))}
      </div>
    );
  } else if (!soon) {
    body = <div className={styles.empty}>Couldn't load what's coming up.</div>;
  } else if (scheduled.length === 0) {
    // Projected interest alone isn't "something scheduled"; the chart shows it.
    body = <div className={styles.empty}>Nothing scheduled in the next 30 days.</div>;
  } else {
    body = (
      <>
        <div className={styles.upcomingList}>
          {shown.map((event, index) => (
            <UpcomingRow
              key={`${event.subscription_id ?? "interest"}-${event.date}-${index}`}
              ref={(el) => {
                rows.current[index] = el;
              }}
              event={event}
              currency={account.currency}
              warnBelow={warn}
              onOpen={isScheduled(event) ? () => open(event, index) : undefined}
            />
          ))}
        </div>
        <div className={styles.cardFoot}>
          <span className={styles.cardFootLabel}>
            {more > 0 ? `+${more} more · ` : ""}Net change by {dayShort(soon.until)}
          </span>
          <span
            className={`${styles.cardFootValue} ${soon.netChange >= 0 ? styles.up : styles.down}`}
          >
            {signedAmount(soon.netChange, account.currency, fmt)}
          </span>
        </div>
      </>
    );
  }

  return (
    <section
      ref={card}
      className={`${styles.card} ${styles.upcomingCard}`}
      aria-labelledby="account-upcoming-title"
    >
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle} id="account-upcoming-title">
            Upcoming
          </h2>
          <div className={styles.sectionSub}>
            Next 30 days
            {soon && scheduled.length > 0 && ` · ${soon.events.length} scheduled`}
          </div>
        </div>
        <TextLink
          to={`/scheduled?account=${account.id}`}
          aria-label="Manage scheduled transactions"
        >
          Manage
        </TextLink>
      </div>
      {body}

      {/* Portalled, so the dialogs sit above the page whatever the card's
          animated ancestors do to positioning. */}
      {createPortal(
        <AnimatePresence>
          {acting && (
          <UpcomingActions
            key="upcoming-actions"
            event={acting}
            accountName={account.name}
            currency={account.currency}
            warnBelow={warn}
            nextDate={data ? nextOccurrence(data.events, acting) : null}
            busy={actions.busy}
            onPostNow={() => void act(actions.postNow)}
            onSkip={() => void act(actions.skip)}
            onEdit={() => void editSchedule()}
            onClose={close}
          />
        )}
        {editing && (
          <AddSubscriptionModal
            key="edit-schedule"
            subscription={editing}
            onClose={() => {
              setEditing(null);
              focusList(lastIndex.current);
            }}
          />
        )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}
