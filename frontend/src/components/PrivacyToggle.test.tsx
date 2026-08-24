import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrivacyToggle from "./PrivacyToggle";
import { PrivacyProvider } from "../privacy/PrivacyProvider";
import { useMoney } from "../privacy/useMoney";

function Balance() {
  const { fmt } = useMoney();
  return <span data-testid="balance">{fmt(2500, "GBP")}</span>;
}

describe("PrivacyToggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers to hide amounts while they are showing", () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
      </PrivacyProvider>,
    );
    const btn = screen.getByRole("button", { name: "Hide amounts" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("flips to offering to show them again once pressed", () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
      </PrivacyProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
    expect(
      screen.getByRole("button", { name: "Show amounts" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("masks amounts elsewhere in the tree when pressed", () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <Balance />
      </PrivacyProvider>,
    );
    expect(screen.getByTestId("balance")).toHaveTextContent("£2,500.00");
    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
    expect(screen.getByTestId("balance")).toHaveTextContent("£****");
  });
});
