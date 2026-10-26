import { describe, it, expect } from "vitest";
import { KIND_OPTIONS, kindSign } from "./scheduled";

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
