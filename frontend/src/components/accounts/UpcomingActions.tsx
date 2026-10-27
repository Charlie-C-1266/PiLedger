import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import Modal from "../Modal";
import UpcomingRow from "./UpcomingRow";
import { ChevronRightIcon, RepeatIcon } from "../icons";
import { dayShort, dayWithWeekday } from "../../screens/account/projectionModel";
import type { BalanceProjectionEvent } from "../../types";
import styles from "./UpcomingActions.module.css";

interface Props {
  event: BalanceProjectionEvent;
  /** The account the page is about, named in the hints. */
  accountName: string;
  currency: string;
  warnBelowZero?: boolean;
  /** The item's next occurrence after this one, if the projection has it. */
  nextDate: string | null;
  /** A Post now or Skip is in flight: further clicks are ignored. */
  busy?: boolean;
  onPostNow: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onClose: () => void;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

/**
 * What you can do with one scheduled item on its way: Post now, Skip this one,
 * or Edit schedule. Opens from an Upcoming row; focus starts on Post now and
 * stays inside until it closes (Cancel, Escape or a click outside), when the
 * page returns it to the row.
 */
export default function UpcomingActions({
  event,
  accountName,
  currency,
  warnBelowZero = true,
  nextDate,
  busy = false,
  onPostNow,
  onSkip,
  onEdit,
  onClose,
}: Props) {
  const titleId = useId();
  const statusId = useId();
  const body = useRef<HTMLDivElement>(null);
  const postNow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    postNow.current?.focus();
  }, []);

  // Keep Tab and Shift+Tab inside the dialog.
  const trapFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !body.current) return;
    const items = Array.from(body.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const guard = (fn: () => void) => () => {
    if (!busy) fn();
  };

  const due = dayShort(event.date);
  const next = nextDate ? ` Next one: ${dayShort(nextDate)}.` : "";
  const postHint = event.auto_post
    ? `Records it on ${accountName} today, so it won't post again on ${due}.`
    : `Records it on ${accountName} today and takes ${due} out of the projection.`;
  const skipHint = event.auto_post
    ? `Nothing posts on ${due}.${next}`
    : `Takes ${due} out of the projection.${next}`;

  return (
    <Modal onClose={onClose} labelledBy={titleId} describedBy={statusId}>
      <div ref={body} onKeyDown={trapFocus}>
        <h2 className={styles.title} id={titleId}>
          {event.name}
        </h2>
        <div className={styles.summary}>
          <UpcomingRow
            event={event}
            currency={currency}
            warnBelowZero={warnBelowZero}
            title={`Due ${dayWithWeekday(event.date)}`}
          />
        </div>
        <p className={styles.status} id={statusId}>
          {event.auto_post ? (
            <>
              <RepeatIcon className={styles.statusIcon} aria-hidden="true" />
              <span>Posts automatically on {due}.</span>
            </>
          ) : (
            <span>Reminder only: it won't post by itself.</span>
          )}
        </p>
        <div className={styles.actions} aria-busy={busy || undefined}>
          <button ref={postNow} type="button" className={styles.action} onClick={guard(onPostNow)}>
            <span>
              <span className={styles.label}>Post now</span>
              <span className={styles.hint}>{postHint}</span>
            </span>
          </button>
          <button type="button" className={styles.action} onClick={guard(onSkip)}>
            <span>
              <span className={styles.label}>Skip this one</span>
              <span className={styles.hint}>{skipHint}</span>
            </span>
          </button>
          <button type="button" className={styles.action} onClick={guard(onEdit)}>
            <span>
              <span className={styles.label}>Edit schedule</span>
              <span className={styles.hint}>Change the amount, dates or account from now on.</span>
            </span>
            <ChevronRightIcon className={styles.chevron} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
