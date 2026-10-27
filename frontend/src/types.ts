export type AccountType = "current" | "savings" | "loan" | "credit" | "invest";
export type RangeKey = "7D" | "30D" | "90D" | "1Y";
export type Currency = string;

export interface Account {
  id: number;
  user_id: number;
  name: string;
  type: AccountType;
  subtype: string;
  /** Catalogue slug for the provider the account is held with, or null if
   * unrecorded. See `lib/institutions.ts` for names, colours and marks. */
  institution: string | null;
  /** The user-typed provider name, set only when `institution` is "other". */
  institution_name: string | null;
  currency: Currency;
  interest_rate: number;
  color: string;
  counts_to_net_worth: boolean;
  closed: boolean;
  created_at: string;
  current_balance: number | null;
  last_updated: string | null;
  /** "Warn me below": the amount under which this asset account is flagged,
   * in its own currency. Null warns only below zero. Never set on debt. */
  low_balance_threshold?: number | null;
  /** From `GET /api/accounts` only: the first day in the next 30 that this
   * open asset account is projected to close below its threshold (zero when
   * unset), with that day's balance. Null when it stays above. */
  low_balance?: LowBalance | null;
}

/** When an account is projected to run low: the first day under its
 * threshold (`YYYY-MM-DD`, today when it already is) and that balance. */
export interface LowBalance {
  date: string;
  balance: number;
}

export interface Transaction {
  id: number;
  user_id: number;
  account_id: number;
  amount: number;
  occurred_at: string;
  merchant: string;
  category: string;
  note: string;
  transfer_id?: string | null;
  /** The scheduled item that created this row (auto-posted or "Post now");
   * null for anything entered by hand. */
  subscription_id?: number | null;
  created_at: string;
}

export type TxnSort = "date" | "date_asc" | "amount" | "amount_asc";

export interface TransactionFilters {
  search?: string;
  account?: number;
  category?: string;
  sort?: TxnSort;
  page?: number;
  per_page?: number;
}

export type ImportDateFormat = "iso" | "dmy" | "mdy" | "dmy_dash" | "mdy_dash";

export interface ImportMapping {
  date: string;
  amount?: string;
  debit?: string;
  credit?: string;
  merchant: string;
  category?: string;
  note?: string;
}

export interface ImportPreview {
  columns: string[];
  sample_rows: string[][];
  row_count: number;
  suggested_mapping: Partial<Record<keyof ImportMapping, string | null>>;
  /** Rows matching a transaction a schedule already posted; filled only when
   * the preview was sent an account and a mapping. */
  matches: ImportMatchedRow[];
}

/** A CSV row (1-based) that matches a transaction a schedule already posted:
 * the bank's date, description and amount, plus the posted transaction (its
 * id, the scheduled item's name and its date). Dates are `YYYY-MM-DD`. */
export interface ImportMatchedRow {
  row: number;
  date: string;
  merchant: string;
  amount: number;
  match: { transaction_id: number; name: string; date: string };
}

/** The user's choice for a matched row: claim the posted transaction, or
 * import the row as a new one. */
export interface ImportMatchChoice {
  row: number;
  claim: boolean;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  /** Rows that claimed a scheduled transaction instead of adding a new one. */
  matched: number;
  skipped_duplicates: number;
  errors: ImportRowError[];
}

export interface Goal {
  id: number;
  user_id: number;
  name: string;
  target: number;
  saved: number;
  monthly: number;
  color: string;
  account_id?: number | null;
  account_name?: string | null;
  interest_rate?: number | null;
  created_at: string;
}

export type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

/** What a scheduled item does with money: a payment out of `account_id`,
 * income into it, or a transfer from `account_id` to `to_account_id`. The
 * amount is always positive; the kind gives the sign. Mirrors
 * `constants.SubscriptionKind` on the backend. */
export type SubscriptionKind = "expense" | "income" | "transfer";

/** A scheduled item (payment, income or transfer). Named `Subscription` after
 * the `/api/subscriptions` resource it comes from. */
export interface Subscription {
  id: number;
  user_id: number;
  name: string;
  amount: number;
  category: string;
  kind: SubscriptionKind;
  account_id?: number | null;
  account_name?: string | null;
  /** A transfer's destination; always null for payments and income. */
  to_account_id?: number | null;
  to_account_name?: string | null;
  frequency: Frequency;
  start_date: string;
  end_date?: string | null;
  color: string;
  notes: string;
  active: boolean;
  /** Computed server-side: next due date on/after today, or null if inactive/elapsed. */
  next_due_date?: string | null;
  /** Automatic: each occurrence posts itself as a real transaction. Off means
   * a reminder (only shown and projected). */
  auto_post?: boolean;
  /** The first day auto-post may post (the day it was switched on); null
   * while it's off. Earlier dates are never back-filled. */
  auto_post_from?: string | null;
  created_at: string;
}

/** One expanded calendar hit from `GET /api/subscriptions/occurrences`. */
export interface SubscriptionOccurrence {
  date: string;
  subscription_id: number;
  name: string;
  amount: number;
  color: string;
  kind: SubscriptionKind;
  account_id?: number | null;
  to_account_id?: number | null;
  /** From the posting log: null while the date is still to come or unhandled. */
  status?: "posted" | "skipped" | null;
}

export interface Summary {
  total: number;
  total_current: number;
  total_savings: number;
  total_loans: number;
  total_credit: number;
  total_invest: number;
  assets: number;
  debts: number;
  savings_rate: number;
  set_aside: number;
  total_net_worth: number;
  account_count: number;
  base_currency: Currency;
  missing_rates: Currency[];
}

export interface NetWorthPoint {
  date: string;
  value: number;
}

/** One balance reading in an account's history series (own currency, uncovered). */
export interface AccountHistoryPoint {
  balance: number;
  date: string;
}

/** One account's balance history over a window, from `GET /api/history/all`.
 * Balances are in the account's own `currency` — they are not converted to base. */
export interface AccountHistory {
  id: number;
  name: string;
  color: string;
  type: AccountType;
  currency: Currency;
  history: AccountHistoryPoint[];
}

/** One balance reading for a single account, from
 * `GET /api/accounts/{aid}/history`. Balance stays in the account's own
 * currency — it is not converted to base. */
export interface AccountBalanceEntry {
  balance: number;
  notes: string | null;
  recorded_at: string;
}

/** One account's recent movement, from `GET /api/accounts/{aid}/activity`.
 * Figures stay in the account's own currency. */
export interface AccountActivity {
  /** Start of the window, `days` before now (UTC ISO). */
  since: string;
  /** The balance at `since` (latest snapshot at or before it), or null when
   * the account's history starts inside the window. */
  opening_balance: number | null;
  /** Current balance minus `opening_balance`; null without an opening. */
  change: number | null;
  /** Transactions dated on or after `since`. */
  count: number;
  total_in: number;
  /** Debits in the window, as a positive magnitude. */
  total_out: number;
}

/** One month of a savings account's projected balance. */
export interface ProjectionPoint {
  date: string;
  balance: number;
}

/** A single savings account's server-computed projection, from
 * `GET /api/projections`: the account page's projection (scheduled
 * transactions and AER interest) sampled once a month. Figures stay in the
 * account's own `currency` (no base conversion). The `1yr`/`2yr`/`5yr`
 * milestones are pre-computed at 12/24/60 months regardless of the requested
 * `points` horizon. */
export interface AccountProjection {
  id: number;
  name: string;
  color: string;
  currency: Currency;
  initial_balance: number;
  interest_rate: number;
  "1yr": number;
  "2yr": number;
  "5yr": number;
  points: ProjectionPoint[];
}

/** One day's projected closing balance on the account page's chart. */
export interface BalanceProjectionPoint {
  date: string;
  balance: number;
}

/** The projected balance `months` from today (the server clamps month ends). */
export interface BalanceProjectionHorizon {
  months: number;
  date: string;
  balance: number;
  /** `balance` minus today's balance. */
  change: number;
}

/** A scheduled item's kind, or a projected monthly interest credit. */
export type BalanceProjectionEventKind = SubscriptionKind | "interest";

/** One scheduled occurrence (or interest credit) in an account's projection,
 * with the account's balance after it. */
export interface BalanceProjectionEvent {
  date: string;
  /** Null for an interest credit, which isn't a scheduled item. */
  subscription_id: number | null;
  name: string;
  kind: BalanceProjectionEventKind;
  frequency: Frequency;
  category: string;
  /** The other account of a transfer, else null. */
  counterparty_name: string | null;
  /** Signed for this account: money out is negative. */
  amount: number;
  auto_post: boolean;
  balance_after: number;
}

export interface BalanceProjectionSummary {
  min_balance: number;
  min_date: string;
  /** First day an asset account closes below zero; always null for debt. */
  first_negative_date: string | null;
  end_balance: number;
}

/** One account's projected balance, from `GET /api/accounts/{aid}/projection`.
 * Figures stay in the account's own currency; for a debt account they are the
 * amount owed. Posted and skipped occurrences are already left out. */
export interface BalanceProjection {
  account_id: number;
  currency: Currency;
  /** Today, the first day of `points`. */
  as_of: string;
  start_balance: number;
  points: BalanceProjectionPoint[];
  horizons: BalanceProjectionHorizon[];
  events: BalanceProjectionEvent[];
  summary: BalanceProjectionSummary;
}

/** One handled occurrence in a scheduled item's posting log (Post now / Skip). */
export interface SubscriptionPosting {
  subscription_id: number;
  date: string;
  status: "posted" | "skipped";
  transaction_id: number | null;
  transfer_id: string | null;
}

/** One manual FX rate: 1 unit of `currency` = `rate` units of the base currency. */
export interface Rate {
  currency: Currency;
  rate: number;
  updated_at: string;
}

export interface Rates {
  base_currency: Currency;
  rates: Rate[];
}

export interface User {
  id: number;
  username: string;
}

export interface Prefs {
  base_currency: Currency;
}

export interface CustomCategory {
  id: number;
  name: string;
}

export interface Categories {
  defaults: string[];
  custom: CustomCategory[];
}

// Zero-based envelope budget. All money is in pounds (the API exposes cents as
// floats). `spent` is computed live server-side and is never sent on writes.

export interface BudgetIncome {
  id: number;
  label: string;
  amount: number;
  sort_order: number;
}

export interface BudgetEnvelope {
  id: number;
  group_id: number;
  label: string;
  category: string;
  budgeted: number;
  spent: number;
  sort_order: number;
}

export interface BudgetGroup {
  id: number;
  name: string;
  color: string;
  flexible: boolean;
  sort_order: number;
  envelopes: BudgetEnvelope[];
}

export interface BudgetHistoryPoint {
  month: string; // "YYYY-MM"
  budgeted: number;
  spent: number;
}

export interface Budget {
  incomes: BudgetIncome[];
  groups: BudgetGroup[];
  history: BudgetHistoryPoint[];
  base_currency: Currency;
  missing_rates: Currency[];
}

export interface Token {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

// Returned only when a token is minted — carries the raw `pil_...` value, which
// is never recoverable afterwards (the server stores only its hash).
export interface TokenCreated extends Token {
  token: string;
}
