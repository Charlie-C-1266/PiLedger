import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { ToastProvider } from "./ToastProvider";
import { useToast } from "./useToast";

// A tiny consumer that turns the imperative toast API into clickable buttons.
function Harness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Transaction recorded!")}>
        fire success
      </button>
      <button onClick={() => toast.error("Something went wrong")}>
        fire error
      </button>
    </>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
}

const FAST = { success: 20, error: 20 };

describe("ToastProvider", () => {
  it("shows a success toast as a polite status region", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "fire success" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Transaction recorded!");
  });

  it("shows an error toast as an assertive alert", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "fire error" }));
    const toast = screen.getByRole("alert");
    expect(toast).toHaveTextContent("Something went wrong");
  });

  it("stacks multiple toasts", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "fire success" }));
    fireEvent.click(screen.getByRole("button", { name: "fire error" }));
    expect(screen.getByText("Transaction recorded!")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("dismisses a toast when its close button is clicked", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "fire success" }));
    const toast = screen.getByText("Transaction recorded!");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitForElementToBeRemoved(toast);
  });

  it("auto-dismisses after its lifetime elapses", async () => {
    // A short injected lifetime keeps this on real timers, so AnimatePresence's
    // exit animation still resolves and the toast is actually unmounted.
    render(
      <ToastProvider durations={FAST}>
        <Harness />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "fire success" }));
    const toast = screen.getByText("Transaction recorded!");
    await waitForElementToBeRemoved(toast);
  });

  it("throws when useToast is used without a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Harness />)).toThrow(
        "useToast must be used within ToastProvider"
      );
    } finally {
      spy.mockRestore();
    }
  });
});
