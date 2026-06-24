import { describe, it, expect } from "vitest";
import { CURRENCIES, currencySymbol, fmt, fmtShort } from "./currency";

// The negative prefix is a real minus sign (U+2212), not an ASCII hyphen.
const MINUS = "−";

describe("currencySymbol", () => {
  it("maps known currency codes to their symbol", () => {
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("JPY")).toBe("¥");
  });

  it("falls back to the code plus a trailing space for unknown currencies", () => {
    expect(currencySymbol("XYZ")).toBe("XYZ ");
  });
});

describe("fmt", () => {
  it("formats a positive amount with two decimals and grouping", () => {
    expect(fmt(1234.5)).toBe("£1,234.50");
  });

  it("defaults to GBP when no currency is given", () => {
    expect(fmt(10)).toBe("£10.00");
  });

  it("prefixes negatives with a minus sign before the symbol", () => {
    expect(fmt(-1234.5)).toBe(`${MINUS}£1,234.50`);
  });

  it("does not treat zero as negative", () => {
    expect(fmt(0)).toBe("£0.00");
  });

  it("uses zero decimals for JPY", () => {
    expect(fmt(1000, "JPY")).toBe("¥1,000");
    expect(fmt(-1000, "JPY")).toBe(`${MINUS}¥1,000`);
  });

  it("honours an explicit decimals override", () => {
    expect(fmt(1234, "GBP", { decimals: 0 })).toBe("£1,234");
    expect(fmt(1.5, "JPY", { decimals: 2 })).toBe("¥1.50");
  });

  it("uses the code-plus-space fallback for an unknown currency", () => {
    expect(fmt(100, "XYZ")).toBe("XYZ 100.00");
  });
});

describe("fmtShort", () => {
  it("abbreviates millions with one decimal", () => {
    expect(fmtShort(1_500_000)).toBe("£1.5m");
  });

  it("drops a trailing .0 on round millions", () => {
    expect(fmtShort(2_000_000)).toBe("£2m");
  });

  it("abbreviates thousands with one decimal", () => {
    expect(fmtShort(1500)).toBe("£1.5k");
  });

  it("drops a trailing .0 on round thousands", () => {
    expect(fmtShort(1000)).toBe("£1k");
  });

  it("shows values under 1000 in full with two decimals", () => {
    expect(fmtShort(999)).toBe("£999.00");
  });

  it("uses zero decimals under 1000 for JPY", () => {
    expect(fmtShort(999, "JPY")).toBe("¥999");
  });

  it("prefixes negatives with a minus sign", () => {
    expect(fmtShort(-1500)).toBe(`${MINUS}£1.5k`);
  });

  it("respects the currency symbol", () => {
    expect(fmtShort(2500, "USD")).toBe("$2.5k");
  });
});

describe("CURRENCIES", () => {
  it("lists the ten supported currencies with GBP first", () => {
    expect(CURRENCIES).toHaveLength(10);
    expect(CURRENCIES[0]).toEqual({ code: "GBP", name: "British Pound" });
  });

  it("gives every currency a code and a human-readable name", () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});
