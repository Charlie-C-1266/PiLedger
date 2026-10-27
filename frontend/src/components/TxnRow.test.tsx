import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import TxnRow from "./TxnRow";
import type { Transaction } from "../types";

const TXN: Transaction = {
  id: 9,
  user_id: 1,
  account_id: 4,
  amount: -12.5,
  occurred_at: "2026-10-24T10:00:00Z",
  merchant: "Pret A Manger",
  category: "Eating out",
  note: "",
  created_at: "2026-10-24T10:00:00Z",
};

function AccountPageStub() {
  const { id } = useParams();
  return <div>Account page {id}</div>;
}

function renderRow(props: Partial<React.ComponentProps<typeof TxnRow>> = {}) {
  return render(
    <MemoryRouter initialEntries={["/transactions"]}>
      <Routes>
        <Route path="/transactions" element={<TxnRow txn={TXN} {...props} />} />
        <Route path="/accounts/:id" element={<AccountPageStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TxnRow", () => {
  it("shows the merchant, category and signed amount", () => {
    renderRow();
    expect(screen.getByText("Pret A Manger")).toBeInTheDocument();
    expect(screen.getByText(/Eating out ·/)).toBeInTheDocument();
    expect(screen.getByText("−£12.50")).toBeInTheDocument();
  });

  it("marks a row a scheduled item posted with the repeat icon", () => {
    renderRow({ txn: { ...TXN, subscription_id: 3 } });
    const mark = screen.getByRole("img", { name: "Posted from a schedule" });
    expect(mark).toHaveAttribute("title", "Posted from a schedule");
  });

  it("has no repeat icon on a row entered by hand", () => {
    renderRow({ txn: { ...TXN, subscription_id: null } });
    expect(
      screen.queryByRole("img", { name: "Posted from a schedule" }),
    ).not.toBeInTheDocument();
  });

  it("has no account column, and so no link, without an account name", () => {
    renderRow();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links the account name to that account's page", () => {
    renderRow({ accountName: "Household" });
    expect(screen.getByRole("link", { name: "Household" })).toHaveAttribute(
      "href",
      "/accounts/4",
    );
  });

  it("follows the account link without opening the row's editor", async () => {
    const onClick = vi.fn();
    renderRow({ accountName: "Household", onClick });

    await userEvent.click(screen.getByRole("link", { name: "Household" }));

    expect(screen.getByText("Account page 4")).toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("still opens the editor when the rest of the row is clicked", async () => {
    const onClick = vi.fn();
    renderRow({ accountName: "Household", onClick });

    await userEvent.click(screen.getByText("Pret A Manger"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
