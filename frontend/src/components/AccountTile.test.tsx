import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountTile from "./AccountTile";
import { PrivacyProvider } from "../privacy/PrivacyProvider";
import type { Account } from "../types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    user_id: 1,
    name: "Monzo",
    type: "current",
    subtype: "general",
    institution: null,
    institution_name: null,
    currency: "GBP",
    interest_rate: 0,
    color: "#6366f1",
    counts_to_net_worth: true,
    closed: false,
    created_at: "2026-01-01T00:00:00Z",
    current_balance: 100,
    last_updated: null,
    ...overrides,
  };
}

describe("AccountTile", () => {
  it("shows a Closed badge for a closed account, even without the badge prop", () => {
    render(<AccountTile account={makeAccount({ closed: true })} />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("does not show a Closed badge for an open account", () => {
    render(<AccountTile account={makeAccount({ closed: false })} />);
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("shows Set aside instead of Closed for an open, excluded account when badge is set", () => {
    render(
      <AccountTile
        account={makeAccount({ closed: false, counts_to_net_worth: false })}
        badge
      />,
    );
    expect(screen.getByText("Set aside")).toBeInTheDocument();
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("prefers the Closed badge over Set aside when both apply", () => {
    render(
      <AccountTile
        account={makeAccount({ closed: true, counts_to_net_worth: false })}
        badge
      />,
    );
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText("Set aside")).not.toBeInTheDocument();
  });

  it("shows the institution name and mark when one is recorded", () => {
    render(<AccountTile account={makeAccount({ institution: "chase" })} />);
    expect(screen.getByText("Chase")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Chase" })).toBeInTheDocument();
  });

  it("keeps the account type visible alongside a known institution", () => {
    render(<AccountTile account={makeAccount({ institution: "chase" })} />);
    expect(screen.getByText(/CURRENT/)).toBeInTheDocument();
  });

  it("names a custom institution from the free-text label", () => {
    render(
      <AccountTile
        account={makeAccount({
          institution: "other",
          institution_name: "Glasgow Credit Union",
        })}
      />,
    );
    expect(screen.getByText("Glasgow Credit Union")).toBeInTheDocument();
  });

  it("falls back to the account type when no institution is recorded", () => {
    render(<AccountTile account={makeAccount({ institution: null })} />);
    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the balance as a figure by default", () => {
    render(<AccountTile account={makeAccount({ current_balance: 1234.5 })} />);
    expect(screen.getByText("£1,234.50")).toBeInTheDocument();
  });

  it("masks the balance when amounts are hidden", () => {
    localStorage.setItem("pl-privacy", "hidden");
    render(
      <PrivacyProvider>
        <AccountTile account={makeAccount({ current_balance: 1234.5 })} />
      </PrivacyProvider>,
    );
    expect(screen.queryByText("£1,234.50")).not.toBeInTheDocument();
    expect(screen.getByText("£****")).toBeInTheDocument();
    localStorage.clear();
  });
});
