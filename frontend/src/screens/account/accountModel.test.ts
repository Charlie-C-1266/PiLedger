import { describe, it, expect } from "vitest";
import {
  formatLongDate,
  formatUpdated,
  netWorthShare,
  parseServerTime,
  rateLabel,
  toBase,
} from "./accountModel";

const GBP_RATES = {
  base_currency: "GBP",
  rates: [{ currency: "USD", rate: 0.8, updated_at: "2026-10-01T00:00:00Z" }],
};

const asset = {
  type: "current" as const,
  currency: "GBP",
  current_balance: 5978.11,
  counts_to_net_worth: true,
};

describe("rateLabel", () => {
  it("formats a rate as an AER to two places", () => {
    expect(rateLabel(4.1)).toBe("4.10% AER");
  });

  it("is null at 0% so callers can leave it out", () => {
    expect(rateLabel(0)).toBeNull();
  });
});

describe("toBase", () => {
  it("passes base-currency amounts through", () => {
    expect(toBase(100, "GBP", GBP_RATES)).toBe(100);
  });

  it("converts with the stored rate", () => {
    expect(toBase(100, "USD", GBP_RATES)).toBeCloseTo(80);
  });

  it("is null when the rate is missing or rates haven't loaded", () => {
    expect(toBase(100, "EUR", GBP_RATES)).toBeNull();
    expect(toBase(100, "GBP", undefined)).toBeNull();
  });
});

describe("netWorthShare", () => {
  it("gives a counted asset's share of net worth", () => {
    const share = netWorthShare(asset, 48210.55, GBP_RATES);
    expect(share).toMatchObject({ kind: "share", total: 48210.55 });
    expect(share?.kind === "share" && share.percent.toFixed(1)).toBe("12.4");
  });

  it("converts a foreign balance before taking its share", () => {
    const share = netWorthShare(
      { ...asset, currency: "USD", current_balance: 1000 },
      8000,
      GBP_RATES,
    );
    expect(share).toEqual({ kind: "share", percent: 10, total: 8000 });
  });

  it("says how much a counted debt reduces net worth, as a magnitude", () => {
    const share = netWorthShare(
      { ...asset, type: "credit", current_balance: 1200 },
      48210.55,
      GBP_RATES,
    );
    expect(share).toEqual({ kind: "reduces", amount: 1200, total: 48210.55 });
  });

  it("treats an overdrawn account as reducing net worth too", () => {
    const share = netWorthShare({ ...asset, current_balance: -50 }, 1000, GBP_RATES);
    expect(share).toEqual({ kind: "reduces", amount: 50, total: 1000 });
  });

  it("marks a set-aside account as not counted, with no conversion needed", () => {
    const share = netWorthShare(
      { ...asset, currency: "EUR", counts_to_net_worth: false },
      1000,
      GBP_RATES,
    );
    expect(share).toEqual({ kind: "excluded", total: 1000 });
  });

  it("hides the line when a counted account's FX rate is missing", () => {
    expect(netWorthShare({ ...asset, currency: "EUR" }, 1000, GBP_RATES)).toBeNull();
  });

  it("hides the line when net worth is zero, negative or unknown", () => {
    expect(netWorthShare(asset, 0, GBP_RATES)).toBeNull();
    expect(netWorthShare(asset, -10, GBP_RATES)).toBeNull();
    expect(netWorthShare(asset, undefined, GBP_RATES)).toBeNull();
  });
});

describe("server times", () => {
  it("reads SQLite's zone-less created_at as UTC", () => {
    expect(parseServerTime("2025-03-04 09:14:00").toISOString()).toBe(
      "2025-03-04T09:14:00.000Z",
    );
  });

  it("reads canonical ISO timestamps as-is", () => {
    expect(parseServerTime("2025-03-04T09:14:00Z").toISOString()).toBe(
      "2025-03-04T09:14:00.000Z",
    );
  });

  it("formats a long date as '4 Mar 2025'", () => {
    expect(formatLongDate("2025-03-04 12:00:00")).toBe("4 Mar 2025");
  });

  it("says Today or Yesterday for recent updates, else the date", () => {
    const now = new Date(2026, 9, 26, 15, 0);
    expect(formatUpdated(new Date(2026, 9, 26, 9, 14).toISOString(), now)).toBe(
      "Today, 09:14",
    );
    expect(formatUpdated(new Date(2026, 9, 25, 18, 2).toISOString(), now)).toBe(
      "Yesterday, 18:02",
    );
    expect(formatUpdated(new Date(2026, 9, 2, 7, 30).toISOString(), now)).toBe(
      "2 Oct, 07:30",
    );
    expect(formatUpdated(new Date(2025, 9, 2, 7, 30).toISOString(), now)).toBe(
      "2 Oct 2025, 07:30",
    );
  });
});
