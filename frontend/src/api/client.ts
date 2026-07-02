import type {
  Account,
  AccountHistory,
  AccountProjection,
  Budget,
  BudgetEnvelope,
  BudgetGroup,
  BudgetIncome,
  Categories,
  CustomCategory,
  Goal,
  ImportDateFormat,
  ImportMapping,
  ImportPreview,
  ImportResult,
  NetWorthPoint,
  Prefs,
  RangeKey,
  Frequency,
  Rates,
  Subscription,
  SubscriptionOccurrence,
  Summary,
  Transaction,
  TransactionFilters,
  User,
} from "../types";

// Group/envelope CRUD return the bare row (no nested envelopes / no live spent);
// the full aggregate comes from getBudget.
type BudgetGroupRow = Omit<BudgetGroup, "envelopes">;
type BudgetEnvelopeRow = Omit<BudgetEnvelope, "spent">;

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

// Fetch the full data export and save it to a file. The endpoint sends the JSON
// with a `Content-Disposition: attachment` filename, which we honour; the
// session cookie authenticates the same-origin request.
export async function exportData(): Promise<void> {
  const res = await fetch("/api/export");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? "piledger-export.json";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Accounts

export const getAccounts = () => json<Account[]>("/api/accounts");

export const createAccount = (data: {
  name: string;
  type: string;
  subtype?: string;
  currency?: string;
  interest_rate?: number;
  color?: string;
  counts_to_net_worth?: boolean;
}) => post<Account>("/api/accounts", data);

export const updateAccount = (id: number, data: Partial<Account>) =>
  put<Account>(`/api/accounts/${id}`, data);

export const removeAccount = (id: number) =>
  del<{ ok: boolean }>(`/api/accounts/${id}`);

export const recordBalance = (accountId: number, balance: number) =>
  post<{ ok: boolean }>(`/api/accounts/${accountId}/balance`, { balance });

// Summary

export const getSummary = () => json<Summary>("/api/summary");

// Net worth

export const getNetWorthSeries = (range: RangeKey = "30D") =>
  json<NetWorthPoint[]>(`/api/history/networth?range=${range}`);

// Per-account balance history over the last `days` (accounts with no points in
// the window are omitted server-side). Balances stay in each account's own
// currency — see `AccountHistory`.
export const getAllHistory = (days = 90) =>
  json<AccountHistory[]>(`/api/history/all?days=${days}`);

// Per savings account: a compound-interest projection `months` ahead, with
// pre-computed 1/2/5-year milestones. Figures stay in each account's own
// currency (no base conversion).
export const getProjections = (months = 24) =>
  json<AccountProjection[]>(`/api/projections?months=${months}`);

// Exchange rates

export const getRates = () => json<Rates>("/api/rates");

/** Replace the user's whole manual-rates table. Rates are 1 unit of `currency`
 * expressed in the base currency; a rate against the base itself is rejected. */
export const updateRates = (rates: { currency: string; rate: number }[]) =>
  put<Rates>("/api/rates", { rates });

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

export const createTransfer = (data: {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  occurred_at?: string;
  note?: string;
}) => post<Transaction[]>("/api/transfers", data);

export const previewImport = (csv_text: string) =>
  post<ImportPreview>("/api/transactions/import/preview", { csv_text });

export const commitImport = (data: {
  csv_text: string;
  account_id: number;
  mapping: ImportMapping;
  date_format?: ImportDateFormat;
}) => post<ImportResult>("/api/transactions/import/commit", data);

// Goals

export const getGoals = () => json<Goal[]>("/api/goals");

export const createGoal = (data: {
  name: string;
  target: number;
  saved?: number;
  monthly?: number;
  color?: string;
  account_id?: number | null;
}) => post<Goal>("/api/goals", data);

export const updateGoal = (id: number, data: Partial<Goal>) =>
  put<Goal>(`/api/goals/${id}`, data);

export const deleteGoal = (id: number) =>
  del<{ ok: boolean }>(`/api/goals/${id}`);

// Subscriptions

export const getSubscriptions = () => json<Subscription[]>("/api/subscriptions");

export const getOccurrences = (from: string, to: string) =>
  json<SubscriptionOccurrence[]>(
    `/api/subscriptions/occurrences?from=${from}&to=${to}`
  );

export const createSubscription = (data: {
  name: string;
  amount: number;
  frequency: Frequency;
  start_date: string;
  category?: string;
  account_id?: number | null;
  end_date?: string | null;
  color?: string;
  notes?: string;
  active?: boolean;
}) => post<Subscription>("/api/subscriptions", data);

export const updateSubscription = (id: number, data: Partial<Subscription>) =>
  put<Subscription>(`/api/subscriptions/${id}`, data);

export const deleteSubscription = (id: number) =>
  del<{ ok: boolean }>(`/api/subscriptions/${id}`);

// Categories

export const getCategories = () => json<Categories>("/api/categories");

export const createCategory = (name: string) =>
  post<CustomCategory>("/api/categories", { name });

export const deleteCategory = (id: number) =>
  del<{ ok: boolean }>(`/api/categories/${id}`);

// Budget (zero-based envelopes)

export const getBudget = () => json<Budget>("/api/budget");

export const createIncome = (data: { label: string; amount?: number }) =>
  post<BudgetIncome>("/api/budget/income", data);

export const updateIncome = (
  id: number,
  data: Partial<Pick<BudgetIncome, "label" | "amount" | "sort_order">>
) => put<BudgetIncome>(`/api/budget/income/${id}`, data);

export const deleteIncome = (id: number) =>
  del<{ ok: boolean }>(`/api/budget/income/${id}`);

export const createGroup = (data: {
  name: string;
  color?: string;
  flexible?: boolean;
}) => post<BudgetGroupRow>("/api/budget/groups", data);

export const updateGroup = (
  id: number,
  data: Partial<Pick<BudgetGroup, "name" | "color" | "flexible" | "sort_order">>
) => put<BudgetGroupRow>(`/api/budget/groups/${id}`, data);

export const deleteGroup = (id: number) =>
  del<{ ok: boolean }>(`/api/budget/groups/${id}`);

export const createEnvelope = (data: {
  group_id: number;
  label: string;
  category: string;
  budgeted?: number;
}) => post<BudgetEnvelopeRow>("/api/budget/envelopes", data);

export const updateEnvelope = (
  id: number,
  data: Partial<
    Pick<BudgetEnvelope, "group_id" | "label" | "category" | "budgeted" | "sort_order">
  >
) => put<BudgetEnvelopeRow>(`/api/budget/envelopes/${id}`, data);

export const deleteEnvelope = (id: number) =>
  del<{ ok: boolean }>(`/api/budget/envelopes/${id}`);
