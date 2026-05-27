import type {
  Account,
  Goal,
  NetWorthPoint,
  Prefs,
  RangeKey,
  Summary,
  Transaction,
  TransactionFilters,
  User,
} from "../types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function del<T>(url: string): Promise<T> {
  return json<T>(url, { method: "DELETE" });
}

// Auth / user

export const getMe = () => json<User>("/api/auth/me");
export const getPrefs = () => json<Prefs>("/api/prefs");
export const updatePrefs = (data: Partial<Prefs>) => put<Prefs>("/api/prefs", data);

export const logout = () => post<{ ok: boolean }>("/api/auth/logout", {});

export const changePassword = (data: {
  current_password: string;
  new_password: string;
}) => put<{ ok: boolean }>("/api/auth/password", data);

export const deleteAccount = (password: string) =>
  json<{ ok: boolean }>("/api/auth/me", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

// Accounts

export const getAccounts = () => json<Account[]>("/api/accounts");

export const createAccount = (data: {
  name: string;
  type: string;
  subtype?: string;
  currency?: string;
  interest_rate?: number;
  color?: string;
}) => post<Account>("/api/accounts", data);

// Summary

export const getSummary = () => json<Summary>("/api/summary");

// Net worth

export const getNetWorthSeries = (range: RangeKey = "30D") =>
  json<NetWorthPoint[]>(`/api/history/networth?range=${range}`);

// Transactions

export function getTransactions(filters?: TransactionFilters) {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.account != null) params.set("account", String(filters.account));
  if (filters?.category) params.set("category", filters.category);
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.page != null) params.set("page", String(filters.page));
  if (filters?.per_page != null) params.set("per_page", String(filters.per_page));
  const qs = params.toString();
  return json<Transaction[]>(`/api/transactions${qs ? `?${qs}` : ""}`);
}

export const createTransaction = (data: {
  account_id: number;
  amount: number;
  merchant: string;
  category?: string;
  note?: string;
  occurred_at?: string;
}) => post<Transaction>("/api/transactions", data);

export const updateTransaction = (id: number, data: Partial<Transaction>) =>
  put<Transaction>(`/api/transactions/${id}`, data);

export const deleteTransaction = (id: number) =>
  del<{ ok: boolean }>(`/api/transactions/${id}`);

// Goals

export const getGoals = () => json<Goal[]>("/api/goals");

export const createGoal = (data: {
  name: string;
  target: number;
  saved?: number;
  monthly?: number;
  color?: string;
}) => post<Goal>("/api/goals", data);

export const updateGoal = (id: number, data: Partial<Goal>) =>
  put<Goal>(`/api/goals/${id}`, data);

export const deleteGoal = (id: number) =>
  del<{ ok: boolean }>(`/api/goals/${id}`);
