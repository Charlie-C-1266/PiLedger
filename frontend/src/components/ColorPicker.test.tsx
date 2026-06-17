import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ColorPicker from "./ColorPicker";
import { PRESET_COLORS } from "../theme/swatches";

describe("ColorPicker", () => {
  it("renders a swatch for every preset plus the custom-hex input", () => {
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={() => {}} />);
    PRESET_COLORS.forEach((c) => {
      expect(screen.getByLabelText(`Select colour ${c}`)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Custom hex/)).toBeInTheDocument();
  });

  it("calls onChange with the preset when a swatch is clicked", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={PRESET_COLORS[0]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(`Select colour ${PRESET_COLORS[1]}`));
    expect(onChange).toHaveBeenCalledWith(PRESET_COLORS[1]);
  });

  it("emits a lower-cased hex only once the input is a valid 6-digit colour", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Custom hex/);
    fireEvent.change(input, { target: { value: "#AB" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "#AABBCC" } });
    expect(onChange).toHaveBeenCalledWith("#aabbcc");
  });

  it("defaults the heading to 'Card colour' and honours an override", () => {
    const { rerender } = render(
      <ColorPicker value="#000000" onChange={() => {}} />,
    );
    expect(screen.getByText("Card colour")).toBeInTheDocument();
    rerender(<ColorPicker value="#000000" onChange={() => {}} label="Accent" />);
    expect(screen.getByText("Accent")).toBeInTheDocument();
  });
});
