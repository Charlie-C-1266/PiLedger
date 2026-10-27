import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api/client", () => ({
  getAccounts: vi.fn().mockResolvedValue([
    { id: 1, name: "Current", currency: "GBP", closed: false },
    { id: 2, name: "Old Barclays", currency: "GBP", closed: true },
  ]),
  previewImport: vi.fn(),
  previewImportMatches: vi.fn(),
  commitImport: vi.fn(),
}));

import ImportCsvModal from "./ImportCsvModal";
import { previewImport, previewImportMatches, commitImport } from "../api/client";
import type { ImportMatchedRow, ImportPreview } from "../types";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CSV_TEXT = "Date,Amount,Description\n2026-01-01,-12.50,Coffee Shop\n";

const PREVIEW: ImportPreview = {
  columns: ["Date", "Amount", "Description"],
  sample_rows: [["2026-01-01", "-12.50", "Coffee Shop"]],
  row_count: 1,
  suggested_mapping: {
    date: "Date",
    amount: "Amount",
    merchant: "Description",
    category: null,
  },
  matches: [],
};

const NETFLIX_MATCH: ImportMatchedRow = {
  row: 1,
  date: "2026-11-13",
  merchant: "NETFLIX.COM",
  amount: -9.99,
  match: { transaction_id: 41, name: "Netflix", date: "2026-11-12" },
};

const SALARY_MATCH: ImportMatchedRow = {
  row: 3,
  date: "2026-11-28",
  merchant: "ACME LTD",
  amount: 2500,
  match: { transaction_id: 42, name: "Salary", date: "2026-11-28" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewImport).mockResolvedValue(PREVIEW);
  vi.mocked(previewImportMatches).mockResolvedValue(PREVIEW);
  vi.mocked(commitImport).mockResolvedValue({
    imported: 1,
    matched: 0,
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

  it("excludes closed accounts from the import target select", async () => {
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Current" })).toBeInTheDocument()
    );
    expect(
      screen.queryByRole("option", { name: "Old Barclays" })
    ).not.toBeInTheDocument();
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
    const request = {
      csv_text: CSV_TEXT,
      account_id: 1,
      mapping: { date: "Date", amount: "Amount", merchant: "Description" },
      date_format: "iso",
    };
    // The match check runs first with the same request; finding nothing, the
    // import goes straight through without any match choices.
    expect(vi.mocked(previewImportMatches).mock.calls[0][0]).toMatchObject(request);
    const payload = vi.mocked(commitImport).mock.calls[0][0];
    expect(payload).toMatchObject(request);
    expect(payload.match_choices).toBeUndefined();

    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.textContent === "1 transaction imported.")
      ).toBeInTheDocument()
    );
  });

  it("shows per-row errors from the commit result", async () => {
    vi.mocked(commitImport).mockResolvedValue({
      imported: 0,
      matched: 0,
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

describe("ImportCsvModal — rows already posted from a schedule", () => {
  async function uploadAndImport() {
    render(<ImportCsvModal onClose={() => {}} />, { wrapper });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, makeCsvFile(CSV_TEXT));
    await waitFor(() => screen.getByRole("button", { name: "Import" }));
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
  }

  it("lists each match with a switch that starts on, before importing", async () => {
    vi.mocked(previewImportMatches).mockResolvedValue({
      ...PREVIEW,
      matches: [NETFLIX_MATCH],
    });
    await uploadAndImport();

    const toggle = await screen.findByRole("switch", {
      name: "Matches scheduled: Netflix (12 Nov)",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    // The bank's own row: its date, description and signed amount.
    expect(screen.getByText("13 Nov · NETFLIX.COM · −£9.99")).toBeInTheDocument();
    expect(screen.getByText(/1 row matches a transaction already posted/)).toBeInTheDocument();
    expect(commitImport).not.toHaveBeenCalled();
  });

  it("sends the choice for every matched row with the import", async () => {
    vi.mocked(previewImportMatches).mockResolvedValue({
      ...PREVIEW,
      matches: [NETFLIX_MATCH, SALARY_MATCH],
    });
    vi.mocked(commitImport).mockResolvedValue({
      imported: 1,
      matched: 1,
      skipped_duplicates: 0,
      errors: [],
    });
    await uploadAndImport();

    const salary = await screen.findByRole("switch", {
      name: "Matches scheduled: Salary (28 Nov)",
    });
    expect(screen.getByText("28 Nov · ACME LTD · +£2,500.00")).toBeInTheDocument();
    await userEvent.click(salary);
    expect(salary).toHaveAttribute("aria-checked", "false");

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(commitImport).toHaveBeenCalledTimes(1));
    expect(vi.mocked(commitImport).mock.calls[0][0]).toMatchObject({
      csv_text: CSV_TEXT,
      account_id: 1,
      match_choices: [
        { row: 1, claim: true },
        { row: 3, claim: false },
      ],
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          (_, el) =>
            el?.textContent ===
            "1 transaction imported, 1 matched a scheduled transaction."
        )
      ).toBeInTheDocument()
    );
  });

  it("goes back to the mapping step without importing", async () => {
    vi.mocked(previewImportMatches).mockResolvedValue({
      ...PREVIEW,
      matches: [NETFLIX_MATCH],
    });
    await uploadAndImport();
    await screen.findByRole("switch");

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(/1 row found/)).toBeInTheDocument();
    expect(commitImport).not.toHaveBeenCalled();
  });
});
