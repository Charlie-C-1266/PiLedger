import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DetailList from "./DetailList";

describe("DetailList", () => {
  it("renders each pair as a term and its value, in the order given", () => {
    const { container } = render(
      <DetailList
        items={[
          { label: "Nickname", value: "Household" },
          { label: "Interest rate", value: "None" },
        ]}
      />,
    );
    const terms = [...container.querySelectorAll("dt")].map((el) => el.textContent);
    const values = [...container.querySelectorAll("dd")].map((el) => el.textContent);
    expect(terms).toEqual(["Nickname", "Interest rate"]);
    expect(values).toEqual(["Household", "None"]);
  });

  it("puts a mark before the value", () => {
    render(
      <DetailList
        items={[
          {
            label: "Provider",
            value: "Nationwide",
            mark: <span role="img" aria-label="Nationwide mark" />,
          },
        ]}
      />,
    );
    const dd = screen.getByText("Nationwide").closest("dd") as HTMLElement;
    expect(dd.firstElementChild).toHaveAttribute("aria-label", "Nationwide mark");
  });

  it("stacks a note under the value", () => {
    render(
      <DetailList
        items={[
          {
            label: "Net worth",
            value: "Set aside",
            note: "Kept out of your Overview headline and trend.",
          },
        ]}
      />,
    );
    const dd = screen.getByText("Set aside").closest("dd") as HTMLElement;
    expect(dd).toHaveTextContent("Set asideKept out of your Overview headline and trend.");
    expect(dd.className).toMatch(/stack/);
  });
});
