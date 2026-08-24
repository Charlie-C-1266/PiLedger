import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PrivacyProvider, STORAGE_KEY } from "./PrivacyProvider";
import { usePrivacy } from "./usePrivacy";
import { useMoney } from "./useMoney";

function Amounts() {
  const { fmt, fmtShort, hidden } = useMoney();
  const { toggle } = usePrivacy();
  return (
    <div>
      <span data-testid="full">{fmt(1234.5, "GBP")}</span>
      <span data-testid="short">{fmtShort(12_000, "USD")}</span>
      <span data-testid="flag">{String(hidden)}</span>
      <button onClick={toggle}>toggle</button>
    </div>
  );
}

describe("useMoney", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("formats real figures while amounts are shown", () => {
    render(
      <PrivacyProvider>
        <Amounts />
      </PrivacyProvider>,
    );
    expect(screen.getByTestId("full")).toHaveTextContent("£1,234.50");
    expect(screen.getByTestId("short")).toHaveTextContent("$12k");
    expect(screen.getByTestId("flag")).toHaveTextContent("false");
  });

  it("masks both formatters once amounts are hidden", () => {
    render(
      <PrivacyProvider>
        <Amounts />
      </PrivacyProvider>,
    );
    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("full")).toHaveTextContent("£****");
    expect(screen.getByTestId("short")).toHaveTextContent("$****");
    expect(screen.getByTestId("flag")).toHaveTextContent("true");
  });

  it("shows figures outside a provider, so a lone component still formats", () => {
    render(<Amounts />);
    expect(screen.getByTestId("full")).toHaveTextContent("£1,234.50");
    expect(screen.getByTestId("flag")).toHaveTextContent("false");
  });
});

describe("PrivacyProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts hidden when the last choice on this device was to hide", () => {
    localStorage.setItem(STORAGE_KEY, "hidden");
    render(
      <PrivacyProvider>
        <Amounts />
      </PrivacyProvider>,
    );
    expect(screen.getByTestId("full")).toHaveTextContent("£****");
  });

  it("starts shown when nothing is stored", () => {
    render(
      <PrivacyProvider>
        <Amounts />
      </PrivacyProvider>,
    );
    expect(screen.getByTestId("full")).toHaveTextContent("£1,234.50");
  });

  it("persists the choice so a reload keeps amounts hidden", () => {
    render(
      <PrivacyProvider>
        <Amounts />
      </PrivacyProvider>,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe("shown");
    act(() => {
      fireEvent.click(screen.getByText("toggle"));
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("hidden");
  });
});
