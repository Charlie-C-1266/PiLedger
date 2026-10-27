import type { Account, SubscriptionKind } from "../types";

/** User-facing names for each kind of scheduled item, in picker order. */
export const KIND_OPTIONS: { value: SubscriptionKind; label: string }[] = [
  { value: "expense", label: "Payment" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

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
