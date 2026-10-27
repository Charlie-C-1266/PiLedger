import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HorizonTiles from "./HorizonTiles";
import { PrivacyProvider, STORAGE_KEY } from "../../privacy/PrivacyProvider";
import type { BalanceProjectionHorizon } from "../../types";

const HORIZONS: BalanceProjectionHorizon[] = [
  { months: 1, date: "2026-11-26", balance: 3795.89, change: 313.72 },
  { months: 3, date: "2027-01-26", balance: 4329.11, change: 846.94 },
  { months: 6, date: "2027-04-26", balance: 3100, change: -382.17 },
  { months: 12, date: "2027-10-26", balance: 6882.74, change: 3400.57 },
];

function Harness({ onSelect = () => {} }: { onSelect?: (m: number) => void }) {
  const [selected, setSelected] = useState(3);
  return (
    <PrivacyProvider>
      <h2 id="proj">Projected balance</h2>
      <HorizonTiles
        horizons={HORIZONS}
        selected={selected}
        onSelect={(m) => {
          setSelected(m);
          onSelect(m);
        }}
        currency="GBP"
        labelledBy="proj"
      />
    </PrivacyProvider>
  );
}

const radio = (name: RegExp) => screen.getByRole("radio", { name });

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe("HorizonTiles", () => {
  it("is a labelled radio group of four horizons with 3 months selected", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Projected balance" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(radio(/In 3 months/)).toBeChecked();
    expect(radio(/In 3 months/)).toHaveTextContent("£4,329.11+£846.9426 Jan");
    expect(radio(/In 6 months/)).toHaveTextContent("−£382.17");
  });

  it("keeps only the selected tile in the tab order", async () => {
    render(<Harness />);
    expect(radio(/In 3 months/)).toHaveAttribute("tabindex", "0");
    expect(radio(/In 1 month/)).toHaveAttribute("tabindex", "-1");
    await userEvent.tab();
    expect(radio(/In 3 months/)).toHaveFocus();
  });

  it("moves the selection and focus with the arrow keys, wrapping round", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(radio(/In 6 months/)).toBeChecked();
    expect(radio(/In 6 months/)).toHaveFocus();
    expect(radio(/In 6 months/)).toHaveAttribute("tabindex", "0");
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(radio(/In 1 month/)).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(radio(/In 12 months/)).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(radio(/In 1 month/)).toBeChecked();
    await userEvent.keyboard("{End}");
    expect(radio(/In 12 months/)).toBeChecked();
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual([6, 12, 1, 12, 1, 12]);
  });

  it("selects a tile on click", async () => {
    render(<Harness />);
    await userEvent.click(radio(/In 1 month/));
    expect(radio(/In 1 month/)).toBeChecked();
    expect(radio(/In 3 months/)).not.toBeChecked();
  });

  it("masks balances and changes in privacy mode, keeping the signs", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    render(<Harness />);
    expect(radio(/In 3 months/)).toHaveTextContent("£****+£****26 Jan");
    expect(radio(/In 6 months/)).toHaveTextContent("−£****");
  });
});
