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
  account_count: number;
  base_currency: Currency;
  missing_rates: Currency[];
}

export interface NetWorthPoint {
  date: string;
  value: number;
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
