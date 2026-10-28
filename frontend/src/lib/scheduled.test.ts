import { describe, it, expect } from "vitest";
import {
  KIND_OPTIONS,
  autoPostBlocker,
  closedPostingAccount,
  kindSign,
  matchesScheduledFilter,
  readScheduledFilter,
  writeScheduledFilter,
} from "./scheduled";

describe("scheduled kinds", () => {
  it("signs income as money in and payments as money out", () => {
    expect(kindSign("income")).toBe("+");
    expect(kindSign("expense")).toBe("−");
  });

  it("gives a transfer no sign", () => {
    expect(kindSign("transfer")).toBe("");
  });

  it("labels the kinds Payment / Income / Transfer, in that order", () => {
    expect(KIND_OPTIONS.map((o) => o.label)).toEqual([
      "Payment",
      "Income",
      "Transfer",
    ]);
  });
});

const OPEN = { id: 1, name: "Current", closed: false };
const OTHER = { id: 2, name: "Savings", closed: false };
const SHUT = { id: 3, name: "Old bank", closed: true };
const ACCOUNTS = [OPEN, OTHER, SHUT];

describe("autoPostBlocker", () => {
  it("allows an item whose account is chosen and open", () => {
    expect(autoPostBlocker("expense", 1, null, ACCOUNTS)).toBeNull();
    expect(autoPostBlocker("income", 2, null, ACCOUNTS)).toBeNull();
    expect(autoPostBlocker("transfer", 1, 2, ACCOUNTS)).toBeNull();
  });

  it("asks for an account first", () => {
    expect(autoPostBlocker("expense", null, null, ACCOUNTS)).toBe(
      "Choose an account to post this automatically.",
    );
  });

  it("asks for both accounts of a transfer", () => {
    expect(autoPostBlocker("transfer", 1, null, ACCOUNTS)).toBe(
      "Choose both accounts to post this automatically.",
    );
    expect(autoPostBlocker("transfer", null, 2, ACCOUNTS)).toBe(
      "Choose both accounts to post this automatically.",
    );
  });

  it("names a closed account on either side", () => {
    const msg = "Old bank is closed, so this can't post by itself.";
    expect(autoPostBlocker("expense", 3, null, ACCOUNTS)).toBe(msg);
    expect(autoPostBlocker("transfer", 1, 3, ACCOUNTS)).toBe(msg);
  });

  it("ignores a stale destination on a payment", () => {
    expect(autoPostBlocker("expense", 1, 3, ACCOUNTS)).toBeNull();
  });
});

describe("closedPostingAccount", () => {
  it("finds the closed account an item posts to", () => {
    expect(
      closedPostingAccount({ kind: "expense", account_id: 3 }, ACCOUNTS),
    ).toBe(SHUT);
    expect(
      closedPostingAccount(
        { kind: "transfer", account_id: 1, to_account_id: 3 },
        ACCOUNTS,
      ),
    ).toBe(SHUT);
  });

  it("is null when every account is open, unlinked or not loaded yet", () => {
    expect(
      closedPostingAccount({ kind: "income", account_id: 1 }, ACCOUNTS),
    ).toBeNull();
    expect(
      closedPostingAccount({ kind: "expense", account_id: null }, ACCOUNTS),
    ).toBeNull();
    expect(
      closedPostingAccount({ kind: "expense", account_id: 3 }, undefined),
    ).toBeNull();
  });
});

describe("scheduled filter", () => {
  const payment = { kind: "expense" as const, account_id: 1, to_account_id: null };
  const transfer = { kind: "transfer" as const, account_id: 1, to_account_id: 2 };

  it("lets everything through when unfiltered", () => {
    const all = { account: "" as const, kind: "all" as const };
    expect(matchesScheduledFilter(payment, all)).toBe(true);
    expect(matchesScheduledFilter(transfer, all)).toBe(true);
  });

  it("keeps only the chosen kind", () => {
    const transfers = { account: "" as const, kind: "transfer" as const };
    expect(matchesScheduledFilter(payment, transfers)).toBe(false);
    expect(matchesScheduledFilter(transfer, transfers)).toBe(true);
  });

  it("shows a transfer under either of its accounts", () => {
    expect(matchesScheduledFilter(transfer, { account: 1, kind: "all" })).toBe(true);
    expect(matchesScheduledFilter(transfer, { account: 2, kind: "all" })).toBe(true);
    expect(matchesScheduledFilter(transfer, { account: 3, kind: "all" })).toBe(false);
  });

  it("matches a payment on its own account only", () => {
    expect(matchesScheduledFilter(payment, { account: 1, kind: "all" })).toBe(true);
    expect(matchesScheduledFilter(payment, { account: 2, kind: "all" })).toBe(false);
    // Unlinked items never match an account.
    expect(
      matchesScheduledFilter({ kind: "expense", account_id: null }, { account: 1, kind: "all" })
    ).toBe(false);
  });

  it("needs both the account and the kind to match", () => {
    expect(matchesScheduledFilter(payment, { account: 1, kind: "income" })).toBe(false);
    expect(matchesScheduledFilter(payment, { account: 1, kind: "expense" })).toBe(true);
  });

  it("reads the filter from the URL, ignoring values it doesn't know", () => {
    expect(readScheduledFilter(new URLSearchParams("account=2&type=income"))).toEqual({
      account: 2,
      kind: "income",
    });
    expect(readScheduledFilter(new URLSearchParams("account=x&type=salary"))).toEqual({
      account: "",
      kind: "all",
    });
  });

  it("writes the filter into the URL and drops the unfiltered sides", () => {
    const params = new URLSearchParams("q=rent&type=income");
    const next = writeScheduledFilter(params, { account: 3, kind: "all" });
    expect(next.toString()).toBe("q=rent&account=3");
    // The original params are left untouched.
    expect(params.toString()).toBe("q=rent&type=income");
  });
});
