import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TabStrip from "./TabStrip";

const EXPECTED = [
  { label: "Overview", href: "/overview" },
  { label: "Accounts", href: "/accounts" },
  { label: "Txns", href: "/transactions" },
  { label: "Budget", href: "/budget" },
  { label: "Goals", href: "/goals" },
  { label: "Subs", href: "/subscriptions" },
  { label: "Settings", href: "/settings" },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabStrip />
    </MemoryRouter>,
  );
}

describe("TabStrip", () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView; provide a spy so the
    // active-tab-into-view effect can run without throwing.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders every destination, including Subscriptions, with the right links", () => {
    renderAt("/overview");

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(EXPECTED.length);

    for (const { label, href } of EXPECTED) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("marks the matching tab as the current page", () => {
    renderAt("/subscriptions");

    expect(screen.getByRole("link", { name: "Subs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("scrolls the active tab into view so it stays reachable when the strip overflows", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    renderAt("/settings");

    expect(scrollSpy).toHaveBeenCalled();
    // The scrolled element should be the active ("Settings") tab.
    const [callContext] = scrollSpy.mock.contexts ?? [];
    expect(callContext).toBe(screen.getByRole("link", { name: "Settings" }));
  });
});
