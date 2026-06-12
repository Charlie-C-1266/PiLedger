import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SegmentedControl from "./SegmentedControl";

const OPTIONS = [
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "90D", label: "90D" },
] as const;

function setup(value: "7D" | "30D" | "90D" = "30D") {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      options={OPTIONS as unknown as { value: string; label: string }[]}
      value={value}
      onChange={onChange}
      ariaLabel="Time range"
    />,
  );
  return { onChange };
}

describe("SegmentedControl", () => {
  it("renders a radiogroup with one radio per option and marks the selection", () => {
    setup("30D");
    const group = screen.getByRole("radiogroup", { name: "Time range" });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "30D" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "7D" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("calls onChange with the option value when clicked", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("30D");

    await user.click(screen.getByRole("radio", { name: "90D" }));
    expect(onChange).toHaveBeenCalledWith("90D");
  });

  it("activates an option from the keyboard (Enter / Space)", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("30D");

    const seven = screen.getByRole("radio", { name: "7D" });
    seven.focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("7D");

    onChange.mockClear();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("7D");
  });
});
