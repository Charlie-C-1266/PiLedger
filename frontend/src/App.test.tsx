import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("./components/Shell", async () => {
  const rrd = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    default: () => (
      <div data-testid="shell">
        <rrd.Outlet />
      </div>
    ),
  };
});

vi.mock("./screens/Overview", () => ({ default: () => <div>overview-screen</div> }));
vi.mock("./screens/Accounts", () => ({ default: () => <div>accounts-screen</div> }));
vi.mock("./screens/Transactions", () => ({ default: () => <div>transactions-screen</div> }));
vi.mock("./screens/Budget", () => ({ default: () => <div>budget-screen</div> }));
vi.mock("./screens/Goals", () => ({ default: () => <div>goals-screen</div> }));
vi.mock("./screens/Settings", () => ({ default: () => <div>settings-screen</div> }));

import App from "./App";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  it.each([
    ["/overview", "overview-screen"],
    ["/accounts", "accounts-screen"],
    ["/transactions", "transactions-screen"],
    ["/budget", "budget-screen"],
    ["/goals", "goals-screen"],
    ["/settings", "settings-screen"],
  ])("renders %s under the Shell layout", (path, marker) => {
    renderAt(path);
    expect(screen.getByTestId("shell")).toBeInTheDocument();
    expect(screen.getByText(marker)).toBeInTheDocument();
  });

  it("redirects / to /overview", () => {
    renderAt("/");
    expect(screen.getByText("overview-screen")).toBeInTheDocument();
  });

  it("redirects unknown paths to /overview", () => {
    renderAt("/nope/does-not-exist");
    expect(screen.getByText("overview-screen")).toBeInTheDocument();
  });
});
