import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpcomingRow from "./UpcomingRow";
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

function renderRow(props: Partial<Parameters<typeof UpcomingRow>[0]> = {}) {
  return render(
    <PrivacyProvider>
      <UpcomingRow event={NETFLIX} currency="GBP" {...props} />
    </PrivacyProvider>,
  );
}

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe("UpcomingRow", () => {
  it("shows the date badge, name, frequency, amount and the balance after", () => {
    renderRow();
    expect(screen.getByRole("img", { name: "9 Nov 2026" })).toHaveTextContent("9Nov");
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("Monthly · Entertainment")).toBeInTheDocument();
    expect(screen.getByText("−£10.99").className).toMatch(/down/);
    expect(screen.getByText("£4,509.88 after").className).not.toMatch(/low/);
  });

  it("tints the balance after in warn when it goes below zero", () => {
    renderRow({ event: { ...NETFLIX, balance_after: -112.4 } });
    expect(screen.getByText("−£112.40 after").className).toMatch(/low/);
  });

  it("doesn't tint a debt account's balance (the amount owed)", () => {
    renderRow({ event: { ...NETFLIX, balance_after: -112.4 }, warnBelowZero: false });
    expect(screen.getByText("−£112.40 after").className).not.toMatch(/low/);
  });

  it("is a plain row without a handler (projected interest)", () => {
    renderRow();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a labelled button that opens its actions on click, Enter and Space", async () => {
    const onOpen = vi.fn();
    renderRow({ onOpen });
    const row = screen.getByRole("button", { name: "Netflix, −£10.99 on 9 Nov 2026. Options" });
    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("masks amounts in privacy mode, label included", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    renderRow({ onOpen: () => {} });
    expect(screen.getByRole("button", { name: "Netflix, −£**** on 9 Nov 2026. Options" }));
    expect(screen.getByText("£**** after")).toBeInTheDocument();
  });

  describe("on touch", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("opens on a 500ms long-press, not a tap", () => {
      const onOpen = vi.fn();
      renderRow({ onOpen });
      const row = screen.getByRole("button");

      // A quick tap: the synthetic click that follows is ignored.
      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
      fireEvent.pointerUp(row);
      fireEvent.click(row);
      expect(onOpen).not.toHaveBeenCalled();

      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(row).toHaveAttribute("data-pressing", "true");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onOpen).toHaveBeenCalledTimes(1);
    });
  });
});
