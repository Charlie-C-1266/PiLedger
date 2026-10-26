import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TextLink from "./TextLink";

describe("TextLink", () => {
  it("links to its target with a decorative trailing chevron", () => {
    render(
      <MemoryRouter>
        <TextLink to="/transactions?account=4" aria-label="View all transactions for Household">
          View all
        </TextLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "View all transactions for Household" });
    expect(link).toHaveAttribute("href", "/transactions?account=4");
    expect(link).toHaveTextContent("View all");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
