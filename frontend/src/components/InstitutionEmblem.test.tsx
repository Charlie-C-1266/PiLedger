import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InstitutionEmblem from "./InstitutionEmblem";

const CHASE = { name: "Chase", color: "#117ACA", mark: "C" };

describe("InstitutionEmblem", () => {
  it("draws the monogram, labelled with the institution", () => {
    render(<InstitutionEmblem institution={CHASE} />);
    const emblem = screen.getByRole("img", { name: "Chase" });
    expect(emblem).toHaveTextContent("C");
  });

  it("fills the disc with the brand colour", () => {
    const { container } = render(<InstitutionEmblem institution={CHASE} />);
    const disc = container.querySelector("circle[fill]");
    expect(disc).toHaveAttribute("fill", "#117ACA");
  });

  it("under-strokes each ring in white so it survives a same-colour card", () => {
    // A Chase-blue ring on a Chase-blue card would otherwise disappear.
    const { container } = render(<InstitutionEmblem institution={CHASE} />);
    const rings = [...container.querySelectorAll("g circle")];
    const white = rings.filter(
      (c) => c.getAttribute("stroke") === "rgba(255,255,255,0.18)",
    );
    const brand = rings.filter((c) => c.getAttribute("stroke") === "#117ACA");
    expect(white).toHaveLength(brand.length);
    expect(brand.length).toBeGreaterThan(0);
  });

  it("picks legible ink for a light brand colour", () => {
    const { container } = render(
      <InstitutionEmblem institution={{ name: "Wise", color: "#9FE870", mark: "W" }} />,
    );
    expect(container.querySelector("text")).toHaveAttribute("fill", "#10131A");
  });

  it("shrinks the monogram so a four-letter mark stays inside the disc", () => {
    const { container: one } = render(<InstitutionEmblem institution={CHASE} />);
    const { container: four } = render(
      <InstitutionEmblem institution={{ name: "MBNA", color: "#C8102E", mark: "MBNA" }} />,
    );
    const size = (c: HTMLElement) =>
      Number(c.querySelector("text")?.getAttribute("font-size"));
    expect(size(four)).toBeLessThan(size(one));
  });
});
