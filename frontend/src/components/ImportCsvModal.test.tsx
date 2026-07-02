import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  getAccounts: vi.fn().mockResolvedValue([
    { id: 1, name: "Current", currency: "GBP" },
  ]),
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));

import ImportCsvModal from "./ImportCsvModal";
import { previewImport, commitImport } from "../api/client";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CSV_TEXT = "Date,Amount,Description\n2026-01-01,-12.50,Coffee Shop\n";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewImport).mockResolvedValue({
    columns: ["Date", "Amount", "Description"],
    sample_rows: [["2026-01-01", "-12.50", "Coffee Shop"]],
    row_count: 1,
    suggested_mapping: {
      date: "Date",
      amount: "Amount",
      merchant: "Description",
      category: null,
    },
  });
  vi.mocked(commitImport).mockResolvedValue({
    imported: 1,
    skipped_duplicates: 0,
    errors: [],
  });
});

function makeCsvFile(text: string) {
  return new File([text], "export.csv", { type: "text/csv" });
}

describe("ImportCsvModal", () => {
  it("renders the upload step with an account select and file input", async () => {
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    expect(screen.getByText("Import CSV")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Current" })).toBeInTheDocument()
    );
  });

  it("parses the uploaded file and advances to the mapping step", async () => {
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeCsvFile(CSV_TEXT));

    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(previewImport).mock.calls[0][0]).toBe(CSV_TEXT);
    await waitFor(() =>
      expect(screen.getByText(/1 row found/)).toBeInTheDocument()
    );
    // Suggested mapping pre-fills the date/amount/merchant selects.
    expect(screen.getByRole("button", { name: "Import" })).not.toBeDisabled();
  });

  it("commits with the confirmed mapping and shows the result summary", async () => {
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeCsvFile(CSV_TEXT));
    await waitFor(() => screen.getByRole("button", { name: "Import" }));

    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(commitImport).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(commitImport).mock.calls[0][0];
    expect(payload).toMatchObject({
      csv_text: CSV_TEXT,
      account_id: 1,
      mapping: { date: "Date", amount: "Amount", merchant: "Description" },
      date_format: "iso",
    });

    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === "1 transaction imported.")
      ).toBeInTheDocument()
    );
  });

  it("shows per-row errors from the commit result", async () => {
    vi.mocked(commitImport).mockResolvedValue({
      imported: 0,
      skipped_duplicates: 0,
      errors: [{ row: 2, message: "empty amount" }],
    });
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeCsvFile(CSV_TEXT));
    await waitFor(() => screen.getByRole("button", { name: "Import" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/Row 2: empty amount/)).toBeInTheDocument()
    );
  });
});
