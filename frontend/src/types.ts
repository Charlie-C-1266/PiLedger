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
