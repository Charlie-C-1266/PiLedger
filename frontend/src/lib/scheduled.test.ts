import { describe, it, expect } from "vitest";
import {
  KIND_OPTIONS,
  autoPostBlocker,
  closedPostingAccount,
  kindSign,
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
