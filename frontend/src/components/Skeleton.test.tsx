import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Skeleton from "./Skeleton";

describe("Skeleton", () => {
  it("forwards width/height/radius to inline style and is hidden from AT", () => {
    render(<Skeleton width={120} height={40} radius={6} />);
    const el = screen.getByTestId("skeleton");
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("40px");
    expect(el.style.borderRadius).toBe("6px");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts string dimensions and merges extra style", () => {
    render(<Skeleton width="70%" style={{ marginBottom: 8 }} />);
    const el = screen.getByTestId("skeleton");
    expect(el.style.width).toBe("70%");
    expect(el.style.marginBottom).toBe("8px");
  });
});
