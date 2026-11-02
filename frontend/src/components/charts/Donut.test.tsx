import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Donut from "./Donut";

const slices = [
  { value: 60, color: "#111", label: "Cash" },
  { value: 40, color: "#222", label: "Savings" },
];

describe("Donut", () => {
  it("renders nothing when every slice is zero", () => {
    const { container } = render(
      <Donut slices={[{ value: 0, color: "#111", label: "Empty" }]} hoverIdx={null} onHover={() => {}} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("exposes the chart as a single labelled image, not focusable arcs", () => {
    render(<Donut slices={slices} hoverIdx={null} onHover={() => {}} />);

    // The whole donut is one labelled image for assistive tech.
    const img = screen.getByRole("img");
    expect(img.tagName.toLowerCase()).toBe("svg");
    expect(img).toHaveAttribute(
      "aria-label",
      "Distribution across 2 segments: Cash 60%, Savings 40%",
    );

    // Regression: arcs must NOT be focusable-but-silent buttons.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const arcs = img.querySelectorAll("circle");
    expect(arcs).toHaveLength(2);
    arcs.forEach((arc) => {
      expect(arc).not.toHaveAttribute("tabindex");
      expect(arc).not.toHaveAttribute("role", "button");
    });
  });

  it("draws every slice at its share, tiling the whole ring", () => {
    // Regression: each dash pattern repeated every dash + circumference
    // instead of every circumference, so the top-right quarter of the ring was
    // never drawn and the first slice shrank (a 60% slice drew as about 35%).
    const size = 200;
    const thickness = 26;
    const gap = 3;
    render(
      <Donut
        slices={slices}
        size={size}
        thickness={thickness}
        gap={gap}
        hoverIdx={null}
        onHover={() => {}}
      />,
    );
    const circumference = 2 * Math.PI * ((size - thickness) / 2);
    const gapLen = (gap / 360) * circumference;
    const total = slices.reduce((s, sl) => s + sl.value, 0);

    const arcs = [...screen.getByRole("img").querySelectorAll("circle")];
    let expectedStart = gapLen / 2;
    arcs.forEach((arc, i) => {
      const [dash, space] = arc
        .getAttribute("stroke-dasharray")!
        .split(" ")
        .map(Number);
      const start = -Number(arc.getAttribute("stroke-dashoffset"));
      const share = slices[i].value / total;

      // One dash per lap, so nothing wraps into the wrong place.
      expect(dash + space).toBeCloseTo(circumference);
      // Length is the slice's share of the ring, less the gap.
      expect(dash).toBeCloseTo(share * circumference - gapLen);
      // Slices follow on from each other and stay within one lap.
      expect(start).toBeCloseTo(expectedStart);
      expect(start + dash).toBeLessThanOrEqual(circumference);
      // Butt ends: round caps would add length beyond the slice's share.
      expect(arc).toHaveAttribute("stroke-linecap", "butt");
      expectedStart += share * circumference;
    });
  });

  it("prefers an explicit ariaLabel when provided", () => {
    render(
      <Donut slices={slices} hoverIdx={null} onHover={() => {}} ariaLabel="My assets" />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "My assets");
  });

  it("highlights a slice on mouse/pen hover but ignores touch pointers", async () => {
    const onHover = vi.fn();
    const user = userEvent.setup();
    render(<Donut slices={slices} hoverIdx={null} onHover={onHover} />);

    const arcs = screen.getByRole("img").querySelectorAll("circle");
    await user.hover(arcs[1]);
    expect(onHover).toHaveBeenLastCalledWith(1);

    await user.unhover(arcs[1]);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
