export type AccountType = "current" | "savings" | "loan" | "credit" | "invest";
export type RangeKey = "7D" | "30D" | "90D" | "1Y";
export type Currency = string;

export interface Account {
  id: number;
  user_id: number;
  name: string;
  type: AccountType;
  subtype: string;
  currency: Currency;
  interest_rate: number;
  color: string;
  counts_to_net_worth: boolean;
  closed: boolean;
  created_at: string;
  current_balance: number | null;
  last_updated: string | null;
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
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
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

export interface Subscription {
  id: number;
  user_id: number;
  name: string;
  amount: number;
  category: string;
  account_id?: number | null;
  account_name?: string | null;
  frequency: Frequency;
  start_date: string;
  end_date?: string | null;
  color: string;
  notes: string;
  active: boolean;
  /** Computed server-side: next due date on/after today, or null if inactive/elapsed. */
  next_due_date?: string | null;
  created_at: string;
}

/** One expanded calendar hit from `GET /api/subscriptions/occurrences`. */
export interface SubscriptionOccurrence {
  date: string;
  subscription_id: number;
  name: string;
  amount: number;
  color: string;
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

/** One month of a savings-account compound-interest projection. */
export interface ProjectionPoint {
  date: string;
  balance: number;
}

/** A single savings account's server-computed projection, from
 * `GET /api/projections`. Figures stay in the account's own `currency` (no base
 * conversion). The `1yr`/`2yr`/`5yr` milestones are pre-computed at 12/24/60
 * months regardless of the requested `points` horizon. */
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
  theme: string;
  dark_mode: boolean;
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
