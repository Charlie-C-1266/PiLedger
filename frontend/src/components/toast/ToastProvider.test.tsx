import { describe, it, expect, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitForElementToBeRemoved,
  within,
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

describe("ToastProvider actions", () => {
  function ActionHarness({ onUndo }: { onUndo: () => void }) {
    const toast = useToast();
    return (
      <button
        onClick={() =>
          toast.success("Netflix posted to Household", {
            action: { label: "Undo", onClick: onUndo },
          })
        }
      >
        fire undoable
      </button>
    );
  }

  it("shows the action as a button on the toast", () => {
    render(
      <ToastProvider>
        <ActionHarness onUndo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire undoable" }));
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Netflix posted to Household");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("runs the action and dismisses the toast when it's clicked", async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <ActionHarness onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "fire undoable" }));
    const message = screen.getByText("Netflix posted to Household");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitForElementToBeRemoved(message);
  });

  it("keeps a toast with an action up for the action lifetime", () => {
    // Only the dismiss timers: faking animation frames would stall motion.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(
        <ToastProvider durations={{ success: 20, error: 20, action: 500 }}>
          <ActionHarness onUndo={() => {}} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "fire undoable" }));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      // A plain success would have gone at 20ms; the Undo is still reachable.
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a plain toast without an action button", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "fire success" }));
    expect(
      within(screen.getByRole("status")).queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  });
});
