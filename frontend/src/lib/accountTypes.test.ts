import { describe, it, expect } from "vitest";
import { switchableTypes } from "./accountTypes";

describe("switchableTypes", () => {
  it("lets an account that holds money switch between the held types", () => {
    for (const type of ["current", "savings", "invest"] as const) {
      expect(switchableTypes(type)).toEqual(["current", "savings", "invest"]);
    }
  });

  it("lets a debt switch only to another debt", () => {
    for (const type of ["credit", "loan"] as const) {
      expect(switchableTypes(type)).toEqual(["loan", "credit"]);
    }
  });
});
