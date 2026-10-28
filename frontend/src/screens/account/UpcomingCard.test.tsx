import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, BalanceProjection, Subscription } from "../../types";

vi.mock("../../hooks/useAccountProjection", () => ({ useAccountProjection: vi.fn() }));
vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ...actual,
    postOccurrence: vi.fn(),
    skipOccurrence: vi.fn(),
    undoOccurrence: vi.fn(),
    getSubscriptions: vi.fn(),
  };
});
// The schedule form has its own tests; the stub reports which item it opened.
vi.mock("../../components/AddSubscriptionModal", () => ({
  default: ({ subscription, onClose }: { subscription?: Subscription; onClose: () => void }) => (
    <div role="dialog" aria-label="Edit scheduled item">
      {subscription?.name}
      <button onClick={onClose}>Close form</button>
    </div>
  ),
}));

import UpcomingCard from "./UpcomingCard";
import { ToastProvider } from "../../components/toast/ToastProvider";
import { PrivacyProvider } from "../../privacy/PrivacyProvider";
import { useAccountProjection } from "../../hooks/useAccountProjection";
import {
  ApiError,
  getSubscriptions,
  postOccurrence,
  skipOccurrence,
  undoOccurrence,
} from "../../api/client";
import { AS_OF, addDays, makeProjection } from "../../test/projectionFixture";

const ACCOUNT = {
  id: 12,
  name: "Household",
  type: "current",
  currency: "GBP",
  closed: false,
  interest_rate: 1,
} as Account;

const PROJECTION = makeProjection({
  start: 4520.87,
  events: [
    { date: "2026-11-01", name: "Interest", amount: 3.2, kind: "interest", category: "Interest Earned" },
    { date: "2026-11-09", name: "Netflix", amount: -10.99, subscription_id: 4, category: "Entertainment" },
    { date: "2026-11-15", name: "Octopus Energy", amount: -96, subscription_id: 5, auto_post: false },
    { date: "2026-12-09", name: "Netflix", amount: -10.99, subscription_id: 4, category: "Entertainment" },
  ],
});

function renderCard(projection: BalanceProjection | undefined = PROJECTION, account = ACCOUNT) {
  vi.mocked(useAccountProjection).mockReturnValue({
    data: projection,
    isPending: false,
  } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <PrivacyProvider>
          <MemoryRouter>
            <UpcomingCard account={account} />
          </MemoryRouter>
        </PrivacyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}

const card = () => screen.getByRole("region", { name: "Upcoming" });
// The dialog leaves after Modal's exit animation, which can run past the
// default 1s wait when the whole suite shares the CPU.
const dialogGone = () =>
  waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
    timeout: 3000,
  });
const netflixRow = () => screen.getByRole("button", { name: /^Netflix, −£10\.99 on 9 Nov 2026/ });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postOccurrence).mockResolvedValue({} as never);
  vi.mocked(skipOccurrence).mockResolvedValue({} as never);
  vi.mocked(undoOccurrence).mockResolvedValue({ ok: true });
});

describe("UpcomingCard list", () => {
  it("lists the next 30 days with the balance after each, and Manage for this account", () => {
    renderCard();
    expect(within(card()).getByText("Next 30 days · 3 scheduled")).toBeInTheDocument();
    expect(within(card()).getByText("Netflix")).toBeInTheDocument();
    expect(within(card()).getByText("£4,524.07 after")).toBeInTheDocument();
    expect(within(card()).getByRole("link", { name: "Manage scheduled transactions" })).toHaveAttribute(
      "href",
      "/scheduled?account=12",
    );
    expect(within(card()).getByText("Net change by 25 Nov")).toBeInTheDocument();
    expect(within(card()).getByText("−£103.79")).toBeInTheDocument();
  });

  it("keeps projected interest as a plain row", () => {
    renderCard();
    const interest = within(card()).getByText("Interest").closest('[class*="row"]')!;
    expect(interest).toHaveTextContent("Monthly · Interest Earned");
    expect(interest).not.toHaveAttribute("role");
    expect(interest).not.toHaveAttribute("tabindex");
    // Netflix and Octopus Energy open actions; interest doesn't.
    expect(within(card()).getAllByRole("button")).toHaveLength(2);
  });

  it("shows the first 7 and counts the rest", () => {
    const events = Array.from({ length: 9 }, (_, k) => ({
      date: addDays(AS_OF, k + 1),
      name: `Bill ${k + 1}`,
      amount: -10,
      subscription_id: 100 + k,
    }));
    renderCard(makeProjection({ start: 500, events }));
    expect(within(card()).getAllByRole("button")).toHaveLength(7);
    expect(within(card()).getByText("+2 more · Net change by 25 Nov")).toBeInTheDocument();
  });

  it("says when nothing is scheduled, even with interest due", () => {
    renderCard(
      makeProjection({
        events: [{ date: "2026-11-01", name: "Interest", amount: 3, kind: "interest" }],
      }),
    );
    expect(within(card()).getByText("Nothing scheduled in the next 30 days.")).toBeInTheDocument();
    expect(within(card()).queryByText(/Net change/)).not.toBeInTheDocument();
  });

  it("isn't shown for a closed account", () => {
    renderCard(undefined, { ...ACCOUNT, closed: true });
    expect(screen.queryByRole("region", { name: "Upcoming" })).not.toBeInTheDocument();
    expect(useAccountProjection).toHaveBeenCalledWith(12, { enabled: false });
  });
});

describe("UpcomingCard actions", () => {
  it("opens the actions on click and returns focus to the row on Cancel", async () => {
    renderCard();
    await userEvent.click(netflixRow());
    const dialog = screen.getByRole("dialog", { name: "Netflix" });
    expect(within(dialog).getByRole("button", { name: /Post now/ })).toHaveFocus();
    expect(within(dialog).getByText(/Next one: 9 Dec\./)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await dialogGone();
    expect(netflixRow()).toHaveFocus();
  });

  it("opens on Enter and returns focus on Escape", async () => {
    renderCard();
    netflixRow().focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Netflix" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await dialogGone();
    expect(netflixRow()).toHaveFocus();
  });

  it("opens on a touch long-press", async () => {
    // Real timers: faking them while the dialog animates in can leave the
    // animation frame loop stalled for the tests that follow.
    renderCard();
    fireEvent.pointerDown(netflixRow(), { pointerType: "touch", clientX: 1, clientY: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Netflix" }, { timeout: 2000 })).toBeInTheDocument();
  });

  it("posts now, refreshes balances and projections, and confirms with Undo", async () => {
    const { invalidate } = renderCard();
    await userEvent.click(netflixRow());
    await userEvent.click(screen.getByRole("button", { name: /Post now/ }));

    expect(postOccurrence).toHaveBeenCalledWith(4, "2026-11-09");
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Netflix posted to Household");
    const busted = new Set(invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]));
    expect([...busted]).toEqual(
      expect.arrayContaining(["transactions", "accounts", "account-projection", "subscriptions"]),
    );
    await dialogGone();

    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(undoOccurrence).toHaveBeenCalledWith(4, "2026-11-09");
  });

  it("skips one occurrence and can undo it", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: /^Octopus Energy/ }));
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Reminder only: it won't post by itself.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Skip this one/ }));

    expect(skipOccurrence).toHaveBeenCalledWith(5, "2026-11-15");
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Octopus Energy skipped for 15 Nov");
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(undoOccurrence).toHaveBeenCalledWith(5, "2026-11-15");
  });

  it("keeps the dialog open and explains a failed Post now", async () => {
    vi.mocked(postOccurrence).mockRejectedValue(
      new ApiError(400, "That account is closed", "400 Bad Request"),
    );
    renderCard();
    await userEvent.click(netflixRow());
    await userEvent.click(screen.getByRole("button", { name: /Post now/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That account is closed");
    expect(screen.getByRole("dialog", { name: "Netflix" })).toBeInTheDocument();
  });

  it("opens the item's schedule form from Edit schedule", async () => {
    vi.mocked(getSubscriptions).mockResolvedValue([
      { id: 5, name: "Octopus Energy" } as Subscription,
      { id: 4, name: "Netflix" } as Subscription,
    ]);
    renderCard();
    await userEvent.click(netflixRow());
    await userEvent.click(screen.getByRole("button", { name: /Edit schedule/ }));
    const form = await screen.findByRole("dialog", { name: "Edit scheduled item" });
    expect(form).toHaveTextContent("Netflix");
    await userEvent.click(within(form).getByRole("button", { name: "Close form" }));
    expect(netflixRow()).toHaveFocus();
  });
});
