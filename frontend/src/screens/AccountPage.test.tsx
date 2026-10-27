import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Account,
  AccountActivity,
  BalanceProjection,
  Rates,
  Summary,
  Transaction,
} from "../types";

vi.mock("../hooks/useAccounts", () => ({ useAccounts: vi.fn() }));
vi.mock("../hooks/useAccountActivity", () => ({ useAccountActivity: vi.fn() }));
vi.mock("../hooks/useSummary", () => ({ useSummary: vi.fn() }));
vi.mock("../hooks/useRates", () => ({ useRates: vi.fn() }));
vi.mock("../hooks/useTransactions", () => ({ useTransactions: vi.fn() }));
vi.mock("../hooks/useAccountProjection", () => ({ useAccountProjection: vi.fn() }));
vi.mock("../hooks/useAccountHistory", () => ({ useAccountHistory: vi.fn() }));
// The chart has its own tests (it needs Recharts' layout); the stub reports
// which horizon it was asked to draw.
vi.mock("../components/charts/ProjectionChart", () => ({
  default: ({ months, series }: { months: number; series: { rows: unknown[] } }) => (
    <div data-testid="projection-chart">
      {months} months · {series.rows.length} days
    </div>
  ),
}));
// The dialogs have their own tests; stubs here just report what they were opened with.
vi.mock("../components/EditAccountModal", () => ({
  default: ({ account }: { account: Account }) => (
    <div data-testid="edit-account">{account.id}</div>
  ),
}));
vi.mock("../components/TransferModal", () => ({
  default: ({ fromAccountId }: { fromAccountId?: number }) => (
    <div data-testid="transfer">{fromAccountId}</div>
  ),
}));
vi.mock("../components/AddModal", () => ({
  default: ({ accountId, transaction }: { accountId: number; transaction?: Transaction }) => (
    <div data-testid="add-txn">{transaction ? `edit ${transaction.id}` : `add ${accountId}`}</div>
  ),
}));
vi.mock("../components/UpdateBalanceModal", () => ({
  default: ({ account }: { account: Account }) => (
    <div data-testid="update-balance">{account.id}</div>
  ),
}));

import AccountPage from "./AccountPage";
import { PrivacyProvider, STORAGE_KEY } from "../privacy/PrivacyProvider";
import { useAccounts } from "../hooks/useAccounts";
import { useAccountActivity } from "../hooks/useAccountActivity";
import { useSummary } from "../hooks/useSummary";
import { useRates } from "../hooks/useRates";
import { useTransactions } from "../hooks/useTransactions";
import { useAccountProjection } from "../hooks/useAccountProjection";
import { useAccountHistory } from "../hooks/useAccountHistory";
import { ToastProvider } from "../components/toast/ToastProvider";
import { AS_OF, addDays, makeProjection } from "../test/projectionFixture";

function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 12,
    user_id: 1,
    name: "Household",
    type: "current",
    subtype: "joint",
    institution: "nationwide",
    institution_name: null,
    currency: "GBP",
    interest_rate: 1,
    color: "#0d9488",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2025-03-04 09:00:00",
    current_balance: 5978.11,
    last_updated: null,
    ...over,
  };
}

function makeTxn(id: number, over: Partial<Transaction> = {}): Transaction {
  return {
    id,
    user_id: 1,
    account_id: 12,
    amount: -10,
    occurred_at: "2026-10-20T10:00:00Z",
    merchant: `Shop ${id}`,
    category: "Groceries",
    note: "",
    created_at: "2026-10-20T10:00:00Z",
    ...over,
  };
}

const ACTIVITY: AccountActivity = {
  since: "2026-09-26T15:00:00Z",
  opening_balance: 5728.11,
  change: 250,
  count: 3,
  total_in: 400,
  total_out: 150,
};

const RATES: Rates = {
  base_currency: "GBP",
  rates: [{ currency: "USD", rate: 0.8, updated_at: "2026-10-01T00:00:00Z" }],
};

interface Setup {
  accounts?: Account[] | undefined;
  accountsPending?: boolean;
  activity?: AccountActivity;
  total?: number;
  rates?: Rates;
  transactions?: Transaction[];
  projection?: BalanceProjection;
  projectionPending?: boolean;
}

const PROJECTION = makeProjection({
  start: 5978.11,
  events: [
    { date: addDays(AS_OF, 3), name: "Netflix", amount: -10.99, subscription_id: 4 },
    { date: addDays(AS_OF, 33), name: "Salary", amount: 2850, subscription_id: 5 },
  ],
});

function renderPage(path: string, setup: Setup = {}) {
  const accounts = "accounts" in setup ? setup.accounts : [makeAccount()];
  vi.mocked(useAccounts).mockReturnValue({
    data: accounts,
    isPending: setup.accountsPending ?? false,
  } as never);
  vi.mocked(useAccountActivity).mockReturnValue({
    data: setup.activity ?? ACTIVITY,
    isPending: false,
  } as never);
  vi.mocked(useSummary).mockReturnValue({
    data: { total: setup.total ?? 48210.55, base_currency: "GBP" } as Summary,
    isPending: false,
  } as never);
  vi.mocked(useRates).mockReturnValue({ data: setup.rates ?? RATES, isPending: false } as never);
  vi.mocked(useTransactions).mockReturnValue({
    data: setup.transactions ?? [makeTxn(1), makeTxn(2, { amount: 400 }), makeTxn(3)],
    isPending: false,
  } as never);
  vi.mocked(useAccountProjection).mockReturnValue({
    data: setup.projectionPending ? undefined : (setup.projection ?? PROJECTION),
    isPending: setup.projectionPending ?? false,
  } as never);
  vi.mocked(useAccountHistory).mockReturnValue({ data: [], isPending: false } as never);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <PrivacyProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/accounts/:id" element={<AccountPage />} />
              <Route path="/accounts" element={<div>Accounts screen</div>} />
            </Routes>
          </MemoryRouter>
        </PrivacyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("AccountPage header", () => {
  it("names the account, its provider and its type", () => {
    renderPage("/accounts/12");

    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
    expect(screen.getByText("Nationwide · Current account · Joint · 1.00% AER")).toBeInTheDocument();
    // The 48px mark in the header is the provider's.
    const marks = screen.getAllByRole("img", { name: "Nationwide" });
    expect(marks[0]).toHaveStyle({ width: "48px" });
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/accounts");
  });

  it("falls back to the account type when no provider is recorded", () => {
    renderPage("/accounts/12", {
      accounts: [makeAccount({ institution: null, interest_rate: 0, subtype: "general" })],
    });

    expect(screen.getByRole("img", { name: "Current account" })).toHaveStyle({ width: "48px" });
    // No provider, no "general" subtype and no rate at 0%.
    expect(screen.getByText("Current account", { selector: "div" })).toBeInTheDocument();
  });

  it("shows the net-worth chip for a counted account", () => {
    renderPage("/accounts/12");
    expect(screen.getByText("Counts toward net worth")).toBeInTheDocument();
  });

  it("shows Set aside for an excluded account", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ counts_to_net_worth: false })] });
    // Once as the chip, once as the details row's value.
    expect(screen.getAllByText("Set aside").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Counts toward net worth")).not.toBeInTheDocument();
  });

  it("offers Edit, Transfer and Add transaction on an open account", () => {
    renderPage("/accounts/12");
    for (const name of ["Edit", "Transfer", "Add transaction"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("hides Transfer and Add transaction when the account is closed", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ closed: true })] });

    const titleRow = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement;
    expect(within(titleRow).getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("Counts toward net worth")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add transaction" })).not.toBeInTheDocument();
  });
});

describe("AccountPage actions", () => {
  it("opens the edit dialog for this account", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("edit-account")).toHaveTextContent("12");
  });

  it("opens a transfer starting from this account", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(screen.getByTestId("transfer")).toHaveTextContent("12");
  });

  it("adds a transaction to this account", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    expect(screen.getByTestId("add-txn")).toHaveTextContent("add 12");
  });

  it("opens Update balance from the balance card", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByRole("button", { name: "Update balance" }));
    expect(screen.getByTestId("update-balance")).toHaveTextContent("12");
  });
});

describe("AccountPage balance card", () => {
  it("shows the balance and its change vs 30 days ago", () => {
    renderPage("/accounts/12");
    expect(screen.getAllByText("£5,978.11").length).toBeGreaterThan(0);
    expect(screen.getByText("+£250.00")).toHaveAttribute("data-direction", "up");
    expect(screen.getByText("vs 30 days ago")).toBeInTheDocument();
  });

  it("shows a fall as a signed down pill", () => {
    renderPage("/accounts/12", { activity: { ...ACTIVITY, change: -80.5 } });
    expect(screen.getByText("−£80.50")).toHaveAttribute("data-direction", "down");
  });

  it("leaves the pill out when there's no balance from 30 days ago", () => {
    renderPage("/accounts/12", { activity: { ...ACTIVITY, opening_balance: null, change: null } });
    expect(screen.queryByText("vs 30 days ago")).not.toBeInTheDocument();
  });

  it("gives a counted asset's share of net worth", () => {
    renderPage("/accounts/12");
    expect(screen.getByText("12.4% of your £48,210.55 net worth")).toBeInTheDocument();
  });

  it("says a set-aside account isn't counted", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ counts_to_net_worth: false })] });
    expect(screen.getByText("Not counted in your £48,210.55 net worth")).toBeInTheDocument();
  });

  it("says how much a counted debt reduces net worth", () => {
    renderPage("/accounts/12", {
      accounts: [makeAccount({ type: "credit", subtype: "credit_card", current_balance: 1200 })],
    });
    expect(
      screen.getByText("Reduces your £48,210.55 net worth by £1,200.00"),
    ).toBeInTheDocument();
  });

  it("converts a foreign balance to the base currency first", () => {
    renderPage("/accounts/12", {
      accounts: [makeAccount({ currency: "USD", current_balance: 1000 })],
      total: 8000,
    });
    expect(screen.getByText("10.0% of your £8,000.00 net worth")).toBeInTheDocument();
  });

  it("hides the share line when the account's FX rate is missing", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ currency: "EUR" })] });
    expect(screen.queryByText(/your .* net worth/)).not.toBeInTheDocument();
  });

  it("hides the share line when net worth is zero or negative", () => {
    renderPage("/accounts/12", { total: -500 });
    expect(screen.queryByText(/your .* net worth/)).not.toBeInTheDocument();
  });

  it("masks every figure in privacy mode, keeping the signs", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    renderPage("/accounts/12");

    expect(screen.queryByText("£5,978.11")).not.toBeInTheDocument();
    const pill = screen
      .getAllByText("+£****")
      .find((el) => el.hasAttribute("data-direction"));
    expect(pill).toHaveAttribute("data-direction", "up");
    expect(screen.getByText("12.4% of your £**** net worth")).toBeInTheDocument();
  });
});

describe("AccountPage projection", () => {
  const note = () => screen.getByText(/Projections use this account's/);

  it("requests one 12-month projection and a 90-day history with its opening", () => {
    renderPage("/accounts/12");
    expect(useAccountProjection).toHaveBeenCalledWith(12, { enabled: true });
    expect(useAccountHistory).toHaveBeenCalledWith(12, "90D", { opening: true, enabled: true });
  });

  it("shows the four horizons with 3 months selected, and redraws on another", async () => {
    renderPage("/accounts/12");
    expect(screen.getByRole("heading", { name: "Projected balance" })).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Projected balance" });
    expect(within(group).getAllByRole("radio")).toHaveLength(4);
    expect(within(group).getByRole("radio", { name: /In 3 months/ })).toBeChecked();
    expect(screen.getByTestId("projection-chart")).toHaveTextContent("3 months");

    await userEvent.click(within(group).getByRole("radio", { name: /In 12 months/ }));
    expect(screen.getByTestId("projection-chart")).toHaveTextContent("12 months");
  });

  it("gives the lowest point and what the projection includes, with the rate", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ interest_rate: 4.1 })] });
    expect(note()).toHaveTextContent(
      "Lowest point in the next 3 months: £5,967.12 on 29 Oct. Projections use this account's scheduled transactions and 4.10% interest, paid monthly. One-off spending isn't predicted.",
    );
  });

  it("warns when the selected horizon goes overdrawn", async () => {
    renderPage("/accounts/12", {
      projection: makeProjection({
        start: 120,
        events: [{ date: "2027-01-27", name: "Car insurance", amount: -486 }],
      }),
    });
    // 27 Jan is a day past the 3-month horizon (26 Jan), so that view is fine…
    expect(screen.queryByText(/Goes overdrawn/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /In 6 months/ })).toHaveTextContent("−£366.00");

    // …and the 6-month one warns.
    await userEvent.click(screen.getByRole("radio", { name: /In 6 months/ }));
    const warning = screen.getByText("Goes overdrawn on 27 Jan.");
    expect(warning.className).toMatch(/noteWarn/);
  });

  it("draws a flat line plus interest when nothing is scheduled", () => {
    renderPage("/accounts/12", {
      projection: makeProjection({
        start: 5978.11,
        events: [{ date: "2026-11-01", name: "Interest", amount: 4.97, kind: "interest" }],
      }),
    });
    expect(screen.getByText("Nothing scheduled in the next 30 days.")).toBeInTheDocument();
    expect(note()).toHaveTextContent(
      "Lowest point in the next 3 months: £5,978.11 on 26 Oct (today).",
    );
    expect(screen.getByText("From scheduled transactions and interest")).toBeInTheDocument();
  });

  it("shows skeletons while the projection loads", () => {
    renderPage("/accounts/12", { projectionPending: true });
    expect(screen.getByText("Loading projection")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("doesn't project a closed account, or ask for one", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ closed: true })] });
    expect(screen.getByText("Closed accounts don't project")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("projection-chart")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Upcoming" })).not.toBeInTheDocument();
    expect(useAccountProjection).toHaveBeenCalledWith(12, { enabled: false });
    expect(useAccountHistory).toHaveBeenCalledWith(12, "90D", { opening: true, enabled: false });
  });

  it("lists what's coming up in the right column", () => {
    renderPage("/accounts/12");
    const upcoming = screen.getByRole("region", { name: "Upcoming" });
    expect(within(upcoming).getByRole("button", { name: /^Netflix, −£10\.99 on 29 Oct 2026/ }));
    expect(within(upcoming).queryByText("Salary")).not.toBeInTheDocument();
  });
});

describe("AccountPage details", () => {
  const detail = (label: string) =>
    (screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement)
      .textContent;

  it("lists the account's details in a fixed order", () => {
    const { container } = renderPage("/accounts/12", {
      accounts: [makeAccount({ last_updated: "2026-10-02T07:30:00Z" })],
    });
    const terms = [...container.querySelectorAll("dt")].map((el) => el.textContent);
    expect(terms).toEqual([
      "Nickname",
      "Provider",
      "Account type",
      "Interest rate",
      "Currency",
      "Net worth",
      "Tracking since",
      "Balance updated",
    ]);
    expect(detail("Nickname")).toBe("Household");
    expect(detail("Provider")).toBe("NNationwide");
    expect(detail("Account type")).toBe("Current account · Joint");
    expect(detail("Interest rate")).toBe("1.00% AER");
    expect(detail("Currency")).toBe("GBP · £");
    expect(detail("Net worth")).toBe("IncludedIncluded in your Overview headline and trend.");
    expect(detail("Tracking since")).toBe("4 Mar 2025");
    expect(detail("Balance updated")).toMatch(/^2 Oct, \d\d:\d\d$/);
  });

  it("reads Not recorded or None rather than leaving a blank", () => {
    renderPage("/accounts/12", {
      accounts: [makeAccount({ institution: null, interest_rate: 0, last_updated: null })],
    });
    expect(detail("Provider")).toBe("Not recorded");
    expect(detail("Interest rate")).toBe("None");
    expect(detail("Balance updated")).toBe("Not recorded");
  });

  it("explains a set-aside account's net-worth status", () => {
    renderPage("/accounts/12", { accounts: [makeAccount({ counts_to_net_worth: false })] });
    expect(detail("Net worth")).toBe("Set asideKept out of your Overview headline and trend.");
  });
});

describe("AccountPage recent transactions", () => {
  it("lists the latest transactions for this account only", () => {
    renderPage("/accounts/12");

    expect(useTransactions).toHaveBeenCalledWith({ account: 12, per_page: 7 });
    expect(screen.getByText("Shop 1")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days · 3 transactions")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View all transactions for Household" }),
    ).toHaveAttribute("href", "/transactions?account=12");
  });

  it("leaves out the account column on its own page", () => {
    renderPage("/accounts/12");
    const section = screen.getByRole("region", { name: "Recent transactions" });
    // The only link in the card is View all — no per-row account links.
    expect(within(section).getAllByRole("link")).toHaveLength(1);
  });

  it("opens a transaction for editing on click", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByText("Shop 2"));
    expect(screen.getByTestId("add-txn")).toHaveTextContent("edit 2");
  });

  it("says when there are no transactions yet, with a way to add one", async () => {
    renderPage("/accounts/12", {
      transactions: [],
      activity: { ...ACTIVITY, count: 0 },
    });

    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days · 0 transactions")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Recent transactions" });
    await userEvent.click(within(section).getByRole("button", { name: "Add transaction" }));
    expect(screen.getByTestId("add-txn")).toHaveTextContent("add 12");
  });

  it("uses the singular for one transaction", () => {
    renderPage("/accounts/12", { activity: { ...ACTIVITY, count: 1 } });
    expect(screen.getByText("Last 30 days · 1 transaction")).toBeInTheDocument();
  });
});

describe("AccountPage states", () => {
  it("shows Account not found for an id that isn't one of the user's", () => {
    renderPage("/accounts/99");

    expect(screen.getByRole("heading", { name: "Account not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Accounts" })).toHaveAttribute(
      "href",
      "/accounts",
    );
    // The account-specific queries never run for it.
    expect(useAccountActivity).not.toHaveBeenCalled();
    expect(useTransactions).not.toHaveBeenCalled();
  });

  it("shows Account not found for an id that isn't a number", () => {
    renderPage("/accounts/abc");
    expect(screen.getByRole("heading", { name: "Account not found" })).toBeInTheDocument();
  });

  it("shows skeletons, not a false not-found, while accounts load", () => {
    renderPage("/accounts/12", { accounts: undefined, accountsPending: true });

    expect(screen.queryByText("Account not found")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("goes back to the Accounts screen from the back link", async () => {
    renderPage("/accounts/12");
    await userEvent.click(screen.getByRole("link", { name: "Accounts" }));
    expect(screen.getByText("Accounts screen")).toBeInTheDocument();
  });
});
