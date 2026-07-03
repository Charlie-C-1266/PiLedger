import { describe, it, expect } from "vitest";
import {
  assetAccounts,
  donutSlices,
  netPosition,
  pctChange,
} from "./overviewModel";
import type { Account, NetWorthPoint } from "../../types";

function makeAccount(over: Partial<Account>): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Acc",
    type: "current",
    subtype: "general",
    currency: "GBP",
    interest_rate: 0,
    color: "#abcabc",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2024-01-01T00:00:00Z",
    current_balance: 100,
    last_updated: null,
    ...over,
  };
}

function series(...values: number[]): NetWorthPoint[] {
  return values.map((value, i) => ({ date: `2024-01-0${i + 1}`, value }));
}

describe("netPosition", () => {
  it("subtracts the magnitude of debts from assets", () => {
    expect(netPosition(3000, 500)).toBe(2500);
  });

  it("treats debts as a magnitude regardless of sign", () => {
    expect(netPosition(500, 2000)).toBe(-1500);
    expect(netPosition(500, -2000)).toBe(-1500);
  });
});

describe("pctChange", () => {
  it("computes the change from the first point to current", () => {
    expect(pctChange(series(100, 150), 150)).toBeCloseTo(50);
  });

  it("uses |first| as the denominator so direction is preserved when starting negative", () => {
    // first −200 → current −100 is an improvement, so a positive %.
    expect(pctChange(series(-200, -100), -100)).toBeCloseTo(50);
  });

  it("returns null when the series has fewer than two points", () => {
    expect(pctChange(series(100), 100)).toBeNull();
    expect(pctChange([], 100)).toBeNull();
  });

  it("returns null when the series starts at zero (no defined percentage)", () => {
    expect(pctChange(series(0, 100), 100)).toBeNull();
  });

  it("returns null when current is null", () => {
    expect(pctChange(series(100, 150), null)).toBeNull();
  });
});

describe("assetAccounts", () => {
  const cash = makeAccount({ id: 1, type: "current", current_balance: 100 });
  const loan = makeAccount({ id: 2, type: "loan", current_balance: 500 });
  const credit = makeAccount({ id: 3, type: "credit", current_balance: 50 });
  const excluded = makeAccount({
    id: 4,
    type: "savings",
    counts_to_net_worth: false,
  });
  const negative = makeAccount({ id: 5, type: "savings", current_balance: -10 });

  it("keeps only counting, non-debt, non-negative asset accounts", () => {
    const result = assetAccounts([cash, loan, credit, excluded, negative]);
    expect(result.map((a) => a.id)).toEqual([1]);
  });

  it("keeps a zero-balance asset account", () => {
    const zero = makeAccount({ id: 6, current_balance: 0 });
    expect(assetAccounts([zero]).map((a) => a.id)).toEqual([6]);
  });
});

describe("donutSlices", () => {
  it("maps asset accounts to value/colour/label, falling back to a default colour", () => {
    const a = makeAccount({ id: 1, name: "Savings", current_balance: 250, color: "" });
    expect(donutSlices([a])).toEqual([
      { value: 250, color: "#6366f1", label: "Savings" },
    ]);
  });

  it("treats a null balance as zero", () => {
    const a = makeAccount({ name: "Empty", current_balance: null });
    expect(donutSlices([a])[0].value).toBe(0);
  });
});
