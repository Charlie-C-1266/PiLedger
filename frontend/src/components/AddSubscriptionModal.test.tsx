import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  createSubscription: vi.fn().mockResolvedValue({}),
  updateSubscription: vi.fn().mockResolvedValue({}),
  deleteSubscription: vi.fn().mockResolvedValue({}),
  getAccounts: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue({ defaults: [], custom: [] }),
}));

import AddSubscriptionModal from "./AddSubscriptionModal";
import { createSubscription } from "../api/client";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddSubscriptionModal", () => {
  it("submits the parsed payload to createSubscription", async () => {
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });

    await userEvent.type(
      screen.getByPlaceholderText("Name (e.g. Netflix)"),
      "Netflix"
    );
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 9.99)"),
      "9.99"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save subscription" })
    );

    await waitFor(() => expect(createSubscription).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createSubscription).mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Netflix",
      amount: 9.99,
      frequency: "monthly",
    });
    expect(payload.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not submit when the name is blank", async () => {
    render(<AddSubscriptionModal onClose={() => {}} />, { wrapper });
    await userEvent.type(
      screen.getByPlaceholderText("Amount (e.g. 9.99)"),
      "9.99"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save subscription" })
    );
    expect(createSubscription).not.toHaveBeenCalled();
  });
});
