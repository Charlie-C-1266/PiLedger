import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InstitutionMark from "./InstitutionMark";

describe("InstitutionMark", () => {
  it("draws the monogram in the brand colour, labelled with the institution", () => {
    render(
      <InstitutionMark institution={{ name: "Chase", color: "#117ACA", mark: "C" }} />,
    );
    const mark = screen.getByRole("img", { name: "Chase" });
    expect(mark).toHaveTextContent("C");
    expect(mark).toHaveStyle({ background: "#117ACA" });
  });

  it("sizes the badge to the requested edge length", () => {
    render(
      <InstitutionMark
        institution={{ name: "Monzo", color: "#FF4F40", mark: "M" }}
        size={30}
      />,
    );
    expect(screen.getByRole("img", { name: "Monzo" })).toHaveStyle({
      width: "30px",
      height: "30px",
    });
  });

  it("shrinks the text for a longer monogram so it stays inside the badge", () => {
    const { rerender } = render(
      <InstitutionMark institution={{ name: "Chase", color: "#117ACA", mark: "C" }} />,
    );
    const oneChar = getComputedStyle(screen.getByRole("img", { name: "Chase" })).fontSize;

    rerender(
      <InstitutionMark institution={{ name: "MBNA", color: "#C8102E", mark: "MBNA" }} />,
    );
    const fourChars = getComputedStyle(
      screen.getByRole("img", { name: "MBNA" }),
    ).fontSize;

    expect(parseFloat(fourChars)).toBeLessThan(parseFloat(oneChar));
  });

  it("picks legible ink for a light brand colour", () => {
    render(<InstitutionMark institution={{ name: "Wise", color: "#9FE870", mark: "W" }} />);
    expect(screen.getByRole("img", { name: "Wise" })).toHaveStyle({ color: "#10131A" });
  });
});
