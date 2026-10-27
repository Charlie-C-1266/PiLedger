import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpcomingActions from "./UpcomingActions";
import { PrivacyProvider, STORAGE_KEY } from "../../privacy/PrivacyProvider";
import type { BalanceProjectionEvent } from "../../types";

const NETFLIX: BalanceProjectionEvent = {
  date: "2026-11-09",
  subscription_id: 4,
  name: "Netflix",
  kind: "expense",
  frequency: "monthly",
  category: "Entertainment",
  counterparty_name: null,
  amount: -10.99,
  auto_post: true,
  balance_after: 4509.88,
};

function renderDialog(over: Partial<Parameters<typeof UpcomingActions>[0]> = {}) {
  const handlers = {
    onPostNow: vi.fn(),
    onSkip: vi.fn(),
    onEdit: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <PrivacyProvider>
      <UpcomingActions
        event={NETFLIX}
        accountName="Household"
        currency="GBP"
        nextDate="2026-12-09"
        {...handlers}
        {...over}
      />
    </PrivacyProvider>,
  );
  return handlers;
}

const action = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe("UpcomingActions", () => {
  it("is a dialog named after the item, described by its status", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Netflix" });
    expect(dialog).toHaveAccessibleDescription("Posts automatically on 9 Nov.");
    expect(screen.getByText("Due Mon 9 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("£4,509.88 after")).toBeInTheDocument();
  });

  it("explains an automatic item's actions", () => {
    renderDialog();
    expect(action(/Post now/)).toHaveTextContent(
      "Records it on Household today, so it won't post again on 9 Nov.",
    );
    expect(action(/Skip this one/)).toHaveTextContent("Nothing posts on 9 Nov. Next one: 9 Dec.");
    expect(action(/Edit schedule/)).toHaveTextContent(
      "Change the amount, dates or account from now on.",
    );
  });

  it("explains a reminder's actions", () => {
    renderDialog({ event: { ...NETFLIX, auto_post: false }, nextDate: null });
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Reminder only: it won't post by itself.",
    );
    expect(action(/Post now/)).toHaveTextContent(
      "Records it on Household today and takes 9 Nov out of the projection.",
    );
    expect(action(/Skip this one/)).toHaveTextContent("Takes 9 Nov out of the projection.");
    expect(action(/Skip this one/)).not.toHaveTextContent("Next one");
  });

  it("starts focus on Post now and keeps it inside the dialog", async () => {
    renderDialog();
    expect(action(/Post now/)).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab();
    expect(action(/Post now/)).toHaveFocus();
  });

  it("calls the matching handler for each action", async () => {
    const h = renderDialog();
    await userEvent.click(action(/Post now/));
    await userEvent.click(action(/Skip this one/));
    await userEvent.click(action(/Edit schedule/));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onPostNow).toHaveBeenCalledTimes(1);
    expect(h.onSkip).toHaveBeenCalledTimes(1);
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const h = renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(h.onClose).toHaveBeenCalled();
  });

  it("ignores Post now and Skip while one is in flight", async () => {
    const h = renderDialog({ busy: true });
    await userEvent.click(action(/Post now/));
    await userEvent.click(action(/Skip this one/));
    expect(h.onPostNow).not.toHaveBeenCalled();
    expect(h.onSkip).not.toHaveBeenCalled();
  });

  it("masks the summary's amounts in privacy mode; hints carry none", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    renderDialog();
    expect(screen.getByText("−£****")).toBeInTheDocument();
    expect(screen.getByText("£**** after")).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/£\d/);
  });
});
