import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModalActions from "./ModalActions";

describe("ModalActions", () => {
  it("renders Cancel and Save and wires their handlers", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(
      <ModalActions onCancel={onCancel} onSave={onSave} saveLabel="Save account" />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Save account"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("omits Save without onSave and Delete without onDelete", () => {
    render(<ModalActions onCancel={() => {}} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("shows pending labels and disables save + delete while busy", () => {
    render(
      <ModalActions
        onCancel={() => {}}
        onSave={() => {}}
        saveLabel="Save"
        saving
        onDelete={() => {}}
        deleteLabel="Delete"
        deleting
        busy
      />,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    // Cancel stays available so a stuck request can still be dismissed.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("disables save via saveDisabled even when not busy", () => {
    render(
      <ModalActions
        onCancel={() => {}}
        onSave={() => {}}
        saveLabel="Transfer"
        saveDisabled
      />,
    );
    expect(screen.getByRole("button", { name: "Transfer" })).toBeDisabled();
  });
});
