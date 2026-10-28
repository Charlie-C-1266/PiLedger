import type { Account, SubscriptionKind } from "../types";
import { parseIdParam } from "./params";

/** User-facing names for each kind of scheduled item, in picker order. */
export const KIND_OPTIONS: { value: SubscriptionKind; label: string }[] = [
  { value: "expense", label: "Payment" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

/** What the Scheduled screen is narrowed to: one account ("" for all) and one
 * kind ("all" for every kind). Kept in the URL as `?account=` and `?type=`. */
export interface ScheduledFilter {
  account: number | "";
  kind: SubscriptionKind | "all";
}

const KINDS = new Set<string>(KIND_OPTIONS.map((o) => o.value));

/** The filter a Scheduled URL asks for; anything unrecognised means "all". */
export function readScheduledFilter(params: URLSearchParams): ScheduledFilter {
  const type = params.get("type");
  return {
    account: parseIdParam(params.get("account")),
    kind: type && KINDS.has(type) ? (type as SubscriptionKind) : "all",
  };
}

/** `params` with the filter written in, leaving any other params alone. An
 * unfiltered side is left out of the URL rather than written as "all". */
export function writeScheduledFilter(
  params: URLSearchParams,
  filter: ScheduledFilter
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (filter.account === "") next.delete("account");
  else next.set("account", String(filter.account));
  if (filter.kind === "all") next.delete("type");
  else next.set("type", filter.kind);
  return next;
}

/** Whether a scheduled item, or one of its occurrences, passes the filter. A
 * transfer belongs to both of its accounts, so it shows under either one. */
export function matchesScheduledFilter(
  item: {
    kind: SubscriptionKind;
    account_id?: number | null;
    to_account_id?: number | null;
  },
  filter: ScheduledFilter
): boolean {
  if (filter.kind !== "all" && item.kind !== filter.kind) return false;
  if (filter.account === "") return true;
  return postingAccountIds(item.kind, item.account_id, item.to_account_id).includes(
    filter.account
  );
}

/**
 * The sign a scheduled amount is shown with. Amounts are stored positive and
 * the kind gives the direction: income is money in (`+`), a payment is money
 * out (the true minus `−`, U+2212), and a transfer only moves money between
 * your own accounts, so it carries no sign (the transfer icon marks it instead).
 */
export function kindSign(kind: SubscriptionKind): string {
  if (kind === "income") return "+";
  if (kind === "expense") return "−";
  return "";
}

type AccountRef = Pick<Account, "id" | "name" | "closed">;

/** The accounts a scheduled item posts to: its account, plus the destination
 * for a transfer. Unchosen slots stay in the list as null. */
function postingAccountIds(
  kind: SubscriptionKind,
  accountId: number | null | undefined,
  toAccountId: number | null | undefined
): (number | null)[] {
  const ids = kind === "transfer" ? [accountId, toAccountId] : [accountId];
  return ids.map((id) => id ?? null);
}

/** The first closed account among those a scheduled item posts to, or null. */
export function closedPostingAccount(
  item: {
    kind: SubscriptionKind;
    account_id?: number | null;
    to_account_id?: number | null;
  },
  accounts: AccountRef[] | undefined
): AccountRef | null {
  for (const id of postingAccountIds(item.kind, item.account_id, item.to_account_id)) {
    const account = accounts?.find((a) => a.id === id);
    if (account?.closed) return account;
  }
  return null;
}

/**
 * Why a scheduled item can't post automatically yet, as a hint for the
 * switch, or null when it can. Mirrors the API's rule: auto-post needs its
 * account — both accounts, for a transfer — chosen and open.
 */
export function autoPostBlocker(
  kind: SubscriptionKind,
  accountId: number | null,
  toAccountId: number | null,
  accounts: AccountRef[] | undefined
): string | null {
  if (postingAccountIds(kind, accountId, toAccountId).includes(null)) {
    return kind === "transfer"
      ? "Choose both accounts to post this automatically."
      : "Choose an account to post this automatically.";
  }
  const closed = closedPostingAccount(
    { kind, account_id: accountId, to_account_id: toAccountId },
    accounts
  );
  return closed ? `${closed.name} is closed, so this can't post by itself.` : null;
}
