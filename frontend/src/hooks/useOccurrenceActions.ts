import { useCallback, useMemo, useState } from "react";
import { ApiError, postOccurrence, skipOccurrence, undoOccurrence } from "../api/client";
import { useToast } from "../components/toast/useToast";
import { dayShort } from "../screens/account/projectionModel";
import type { BalanceProjectionEvent } from "../types";
import { useInvalidate } from "./useInvalidate";

/** The server's reason when it gave one, else a generic retry message. */
function reason(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.detail ? err.detail : fallback;
}

/**
 * Post now and Skip for one upcoming occurrence on an account's page, each
 * confirmed by a toast with Undo. Posting moves the balance and the posting log
 * moves the projection, so every action (and its Undo) refreshes both.
 * `onSettled` runs after each action or Undo lands, so the page can put focus
 * back in the Upcoming list.
 */
export function useOccurrenceActions(accountName: string, onSettled?: () => void) {
  const inv = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    inv.transactionChanged();
    inv.subscriptionChanged();
  }, [inv]);

  const undo = useCallback(
    async (event: BalanceProjectionEvent) => {
      try {
        await undoOccurrence(event.subscription_id!, event.date);
      } catch (err) {
        toast.error(reason(err, "Couldn't undo that. Please try again."));
      } finally {
        refresh();
        onSettled?.();
      }
    },
    [toast, refresh, onSettled],
  );

  const run = useCallback(
    async (
      event: BalanceProjectionEvent,
      call: (sid: number, date: string) => Promise<unknown>,
      done: string,
      failed: string,
    ): Promise<boolean> => {
      setBusy(true);
      try {
        await call(event.subscription_id!, event.date);
      } catch (err) {
        toast.error(reason(err, failed));
        return false;
      } finally {
        setBusy(false);
      }
      refresh();
      onSettled?.();
      toast.success(done, { action: { label: "Undo", onClick: () => void undo(event) } });
      return true;
    },
    [toast, refresh, undo, onSettled],
  );

  return useMemo(
    () => ({
      busy,
      /** Record the occurrence on the account today. Resolves true on success. */
      postNow: (event: BalanceProjectionEvent) =>
        run(
          event,
          postOccurrence,
          `${event.name} posted to ${accountName}`,
          "Couldn't post that. Please try again.",
        ),
      /** Drop the occurrence from the schedule. Resolves true on success. */
      skip: (event: BalanceProjectionEvent) =>
        run(
          event,
          skipOccurrence,
          `${event.name} skipped for ${dayShort(event.date)}`,
          "Couldn't skip that. Please try again.",
        ),
    }),
    [busy, run, accountName],
  );
}
