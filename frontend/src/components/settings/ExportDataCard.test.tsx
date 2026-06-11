import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ExportDataCard from "./ExportDataCard";
import { exportData } from "../../api/client";

vi.mock("../../api/client", () => ({ exportData: vi.fn() }));

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExportDataCard />
    </QueryClientProvider>,
  );
}

describe("ExportDataCard", () => {
  it("triggers the data export when the button is clicked", async () => {
    vi.mocked(exportData).mockResolvedValue(undefined);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(exportData).toHaveBeenCalledTimes(1));
  });

  it("shows a pending label while the export is in flight", async () => {
    let resolve: () => void = () => {};
    vi.mocked(exportData).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    const pending = await screen.findByRole("button", { name: "Exporting…" });
    expect(pending).toBeDisabled();

    resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
    );
  });

  it("shows an error message when the export fails", async () => {
    vi.mocked(exportData).mockRejectedValue(new Error("500"));
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(
      await screen.findByText(/Couldn't export your data/),
    ).toBeInTheDocument();
  });
});
