import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DeltaPill from "./DeltaPill";

describe("DeltaPill", () => {
  it("shows the signed change it's given", () => {
    render(<DeltaPill direction="up">+£120.00</DeltaPill>);
    expect(screen.getByText("+£120.00")).toBeInTheDocument();
  });

  it("marks the direction so the colour repeats the sign", () => {
    const { rerender } = render(<DeltaPill direction="up">+£1.00</DeltaPill>);
    const up = screen.getByText("+£1.00");
    expect(up).toHaveAttribute("data-direction", "up");
    expect(up.className).toMatch(/up/);

    rerender(<DeltaPill direction="down">−£1.00</DeltaPill>);
    const down = screen.getByText("−£1.00");
    expect(down).toHaveAttribute("data-direction", "down");
    expect(down.className).toMatch(/down/);
  });

  it("forwards a title and accessible label", () => {
    render(
      <DeltaPill direction="down" title="Change over 30D" aria-label="Down 2.4 percent">
        ▼ 2.4%
      </DeltaPill>,
    );
    const pill = screen.getByLabelText("Down 2.4 percent");
    expect(pill).toHaveAttribute("title", "Change over 30D");
  });
});
