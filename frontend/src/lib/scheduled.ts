import type { SubscriptionKind } from "../types";

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
