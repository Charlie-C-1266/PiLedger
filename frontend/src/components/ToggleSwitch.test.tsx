import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToggleSwitch from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("renders the label and hint and reflects a checked state", () => {
    render(
      <ToggleSwitch
        label="Count toward net worth"
        hint="Off keeps it out of your headline."
        checked
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Count toward net worth")).toBeInTheDocument();
    expect(
      screen.getByText("Off keeps it out of your headline."),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("reflects an unchecked state", () => {
    render(<ToggleSwitch label="Count" checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the opposite value on click", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Count" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
