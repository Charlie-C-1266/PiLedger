import { describe, it, expect } from "vitest";
import { parseIdParam } from "./params";

describe("parseIdParam", () => {
  it("reads a positive integer id", () => {
    expect(parseIdParam("3")).toBe(3);
  });

  it("treats a missing, zero, negative or non-integer value as all", () => {
    for (const value of [null, "", "0", "-2", "1.5", "abc"]) {
      expect(parseIdParam(value)).toBe("");
    }
  });
});
