import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Account, Subscription } from "../types";

vi.mock("../api/client", () => ({
  createSubscription: vi.fn().mockResolvedValue({}),
  updateSubscription: vi.fn().mockResolvedValue({}),
  deleteSubscription: vi.fn().mockResolvedValue({}),
  getAccounts: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue({ defaults: [], custom: [] }),
}));

import AddSubscriptionModal from "./AddSubscriptionModal";
import {
  createSubscription,
  getAccounts,
  updateSubscription,
} from "../api/client";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function account(id: number, name: string, currency = "GBP"): Account {
  return {
    id,
    user_id: 1,
    name,
    type: "current",
    subtype: "general",
    institution: null,
    institution_name: null,
    currency,
    interest_rate: 0,
    color: "#6366f1",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2024-01-01T00:00:00Z",
    current_balance: null,
    last_updated: null,
  } as Account;
}

const ACCOUNTS = [
  account(1, "Current"),
  account(2, "Savings"),
  account(3, "Euro", "EUR"),
];

async function fillBasics(name = "Item", amount = "100") {
  await userEvent.type(screen.getByPlaceholderText(/^Name \(e\.g\./), name);
  await userEvent.type(
    screen.getByPlaceholderText("Amount (e.g. 9.99)"),
    amount
  );
}

function autoSwitch() {
  return screen.getByRole("switch", { name: "Post automatically" });
}

const BACKFILL_HINT = "Starts from today — earlier dates aren't back-filled.";

function existingItem(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 7,
    user_id: 1,
    name: "Rent",
    amount: 900,
    category: "",
    kind: "expense",
    account_id: 1,
    account_name: "Current",
    to_account_id: null,
    to_account_name: null,
    frequency: "monthly",
    start_date: "2024-01-01",
    end_date: null,
    color: "",
    notes: "",
    active: true,
    next_due_date: "2026-11-01",
    auto_post: false,
    auto_post_from: null,
    created_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

async function save() {
  await userEvent.click(
    screen.getByRole("button", { name: "Save scheduled item" })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccounts).mockResolvedValue([]);
});

describe("AddSubscriptionModal", () => {
  it("submits the parsed payload to createSubscription", async () => {
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.type(
      screen.getByPlaceholderText("Name (e.g. Netflix)"),
      "Netflix"
    );
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 9.99)"),
      "9.99"
    );
    await save();

    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createSubscription).mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Netflix",
      amount: 9.99,
      frequency: "monthly",
      kind: "expense",
      to_account_id: null,
      // No account, so it can't post by itself: a reminder.
      auto_post: false,
    });
    expect(payload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not submit when the name is blank", async () => {
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 9.99)"),
      "9.99"
    );
    await save();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("titles the modal as a scheduled item and defaults to Payment", () => {
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });
    expect(
      screen.getByRole("heading", { name: "Add scheduled item" })
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Payment" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByLabelText("Paid from")).toBeInTheDocument();
  });

  it("records income into the chosen account", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.click(screen.getByRole("radio", { name: "Income" }));
    expect(screen.queryByLabelText("Paid from")).not.toBeInTheDocument();
    const into = screen.getByLabelText("Paid into");
    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(into, "1");
    await fillBasics("Salary", "2500");
    await save();

    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSubscription).mock.calls[0][0]).toMatchObject({
      name: "Salary",
      amount: 2500,
      kind: "income",
      account_id: 1,
      to_account_id: null,
      auto_post: true,
    });
  });

  it("schedules a transfer between two same-currency accounts", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
    expect(screen.queryByLabelText(/Paid (from|into)/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();

    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(to).toBeDisabled();
    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(from, "1");

    // The To list leaves out the From account and other currencies.
    const toNames = Array.from((to as HTMLSelectElement).options).map(
      (o) => o.text
    );
    expect(toNames).toEqual(["Choose an account", "Savings"]);

    await userEvent.selectOptions(to, "2");
    await fillBasics("Savings pot", "200");
    await save();

    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSubscription).mock.calls[0][0]).toMatchObject({
      name: "Savings pot",
      amount: 200,
      kind: "transfer",
      account_id: 1,
      to_account_id: 2,
      category: "",
      auto_post: true,
    });
  });

  it("won't save a transfer without both accounts", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(screen.getByLabelText("From"), "1");
    await fillBasics();
    await save();

    expect(createSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(/the one it goes to/)).toBeInTheDocument();
  });

  it("drops the destination when an edited transfer becomes a payment", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    const existing: Subscription = {
      id: 7,
      user_id: 1,
      name: "Savings pot",
      amount: 200,
      category: "",
      kind: "transfer",
      account_id: 1,
      account_name: "Current",
      to_account_id: 2,
      to_account_name: "Savings",
      frequency: "monthly",
      start_date: "2024-01-25",
      end_date: null,
      color: "",
      notes: "",
      active: true,
      next_due_date: "2026-11-25",
      created_at: "2024-01-01T00:00:00Z",
    };
    render(<AddSubscriptionModal subscription={existing} onClose={() => {}} />, {
      wrapper,
    });

    expect(screen.getByRole("radio", { name: "Transfer" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await userEvent.click(screen.getByRole("radio", { name: "Payment" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Update scheduled item" })
    );

    await waitFor(() => expect(updateSubscription).toHaveBeenCalledTimes(1));
    const [id, payload] = vi.mocked(updateSubscription).mock.calls[0];
    expect(id).toBe(7);
    expect(payload).toMatchObject({
      kind: "expense",
      account_id: 1,
      to_account_id: null,
      auto_post: false,
    });
  });
});

describe("AddSubscriptionModal — Post automatically", () => {
  it("is off and disabled, with the reason, until an account is chosen", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    expect(autoSwitch()).toBeDisabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Choose an account to post this automatically.")
    ).toBeInTheDocument();
    expect(screen.queryByText(BACKFILL_HINT)).not.toBeInTheDocument();
  });

  it("switches on by itself once an account is chosen, with the back-fill hint", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(screen.getByLabelText("Paid from"), "1");

    expect(autoSwitch()).toBeEnabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(BACKFILL_HINT)).toBeInTheDocument();

    await fillBasics("Rent", "900");
    await save();
    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSubscription).mock.calls[0][0]).toMatchObject({
      account_id: 1,
      auto_post: true,
    });
  });

  it("can be switched off, and stays off when the account changes", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(screen.getByLabelText("Paid from"), "1");
    await userEvent.click(autoSwitch());
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");

    await userEvent.selectOptions(screen.getByLabelText("Paid from"), "2");
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");

    await fillBasics();
    await save();
    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSubscription).mock.calls[0][0]).toMatchObject({
      account_id: 2,
      auto_post: false,
    });
  });

  it("goes off again when the account is unlinked", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await screen.findByRole("option", { name: "Current" });
    const paidFrom = screen.getByLabelText("Paid from");
    await userEvent.selectOptions(paidFrom, "1");
    await userEvent.selectOptions(paidFrom, "");

    expect(autoSwitch()).toBeDisabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("needs both accounts for a transfer", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.click(screen.getByRole("radio", { name: "Transfer" }));
    await screen.findByRole("option", { name: "Current" });
    await userEvent.selectOptions(screen.getByLabelText("From"), "1");

    expect(autoSwitch()).toBeDisabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Choose both accounts to post this automatically.")
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("To"), "2");
    expect(autoSwitch()).toBeEnabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("can't post to a closed account", async () => {
    vi.mocked(getAccounts).mockResolvedValue([
      ...ACCOUNTS,
      { ...account(4, "Old bank"), closed: true },
    ]);
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await screen.findByRole("option", { name: "Old bank" });
    await userEvent.selectOptions(screen.getByLabelText("Paid from"), "4");

    expect(autoSwitch()).toBeDisabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Old bank is closed, so this can't post by itself.")
    ).toBeInTheDocument();
  });

  it("shows a stored reminder as off, and sends auto_post on update", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(
      <AddSubscriptionModal subscription={existingItem()} onClose={() => {}} />,
      { wrapper }
    );
    await screen.findByRole("option", { name: "Current" });

    expect(autoSwitch()).toBeEnabled();
    expect(autoSwitch()).toHaveAttribute("aria-checked", "false");

    await userEvent.click(
      screen.getByRole("button", { name: "Update scheduled item" })
    );
    await waitFor(() => expect(updateSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateSubscription).mock.calls[0][1]).toMatchObject({
      auto_post: false,
    });
  });

  it("shows a stored automatic item as on, and can switch it off", async () => {
    vi.mocked(getAccounts).mockResolvedValue(ACCOUNTS);
    render(
      <AddSubscriptionModal
        subscription={existingItem({
          auto_post: true,
          auto_post_from: "2026-10-01",
        })}
        onClose={() => {}}
      />,
      { wrapper }
    );
    await screen.findByRole("option", { name: "Current" });

    expect(autoSwitch()).toHaveAttribute("aria-checked", "true");
    await userEvent.click(autoSwitch());
    await userEvent.click(
      screen.getByRole("button", { name: "Update scheduled item" })
    );
    await waitFor(() => expect(updateSubscription).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateSubscription).mock.calls[0][1]).toMatchObject({
      auto_post: false,
    });
  });
});
