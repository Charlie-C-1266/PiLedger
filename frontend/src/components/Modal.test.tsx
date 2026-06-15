import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";

describe("Modal", () => {
  it("renders children inside an accessible dialog", () => {
    render(
      <Modal onClose={() => {}}>
        <p>Body content</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("forwards a label as the dialog's accessible name", () => {
    render(
      <Modal onClose={() => {}} label="Add transaction">
        <p>x</p>
      </Modal>
    );
    expect(
      screen.getByRole("dialog", { name: "Add transaction" })
    ).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    // The backdrop is the overlay wrapping the dialog card.
    const backdrop = screen.getByRole("dialog").parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the card", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal onClose={onClose}>
        <button>Inside</button>
      </Modal>
    );
    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders content when reduced motion is requested", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      render(
        <Modal onClose={() => {}}>
          <p>Reduced body</p>
        </Modal>
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Reduced body")).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
