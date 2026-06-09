import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageStagger, StaggerItem } from "./PageStagger";

describe("PageStagger", () => {
  it("renders children and forwards className to the container", () => {
    render(
      <PageStagger className="my-grid" data-testid="container">
        <StaggerItem data-testid="item-1">first</StaggerItem>
        <StaggerItem data-testid="item-2">second</StaggerItem>
      </PageStagger>,
    );

    const container = screen.getByTestId("container");
    expect(container).toHaveClass("my-grid");
    expect(screen.getByTestId("item-1")).toHaveTextContent("first");
    expect(screen.getByTestId("item-2")).toHaveTextContent("second");
  });

  it("StaggerItem forwards className and arbitrary DOM props", () => {
    render(
      <PageStagger>
        <StaggerItem className="card" data-testid="item" role="region">
          body
        </StaggerItem>
      </PageStagger>,
    );

    const item = screen.getByTestId("item");
    expect(item).toHaveClass("card");
    expect(item).toHaveAttribute("role", "region");
    expect(item).toHaveTextContent("body");
  });

  it("renders zero children without crashing", () => {
    render(<PageStagger data-testid="empty" />);
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });
});
