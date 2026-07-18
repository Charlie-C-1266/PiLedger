import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../api/client", () => ({
  getTokens: vi.fn(),
  createToken: vi.fn(),
  deleteToken: vi.fn(),
}));

import ApiTokensCard from "./ApiTokensCard";
import { getTokens, createToken, deleteToken } from "../../api/client";
import type { Token, TokenCreated } from "../../types";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ApiTokensCard />
    </QueryClientProvider>,
  );
}

const EXISTING: Token = {
  id: 7,
  name: "MCP server",
  created_at: "2026-07-01T12:00:00Z",
  last_used_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTokens).mockResolvedValue([]);
});

describe("ApiTokensCard", () => {
  it("lists existing tokens with a revoke control", async () => {
    vi.mocked(getTokens).mockResolvedValue([EXISTING]);
    renderCard();

    // Wait on the revoke button — it's unambiguous, unlike "MCP server", which
    // also appears as a link in the card's hint text.
    expect(
      await screen.findByRole("button", { name: "Revoke MCP server" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/never used/)).toBeInTheDocument();
  });

  it("mints a token and reveals its raw value once", async () => {
    const created: TokenCreated = {
      id: 9,
      name: "CI",
      created_at: "2026-07-12T09:00:00Z",
      last_used_at: null,
      token: "pil_secret_value_abc123",
    };
    vi.mocked(createToken).mockResolvedValue(created);
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/Token name/), {
      target: { value: "CI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // mutationFn receives a context object as a 2nd arg under TanStack Query v5,
    // so assert on the first argument rather than the whole call.
    await waitFor(() => expect(createToken).toHaveBeenCalled());
    expect(vi.mocked(createToken).mock.calls[0][0]).toBe("CI");
    expect(
      await screen.findByText("pil_secret_value_abc123"),
    ).toBeInTheDocument();
  });

  it("copies the freshly minted token to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(createToken).mockResolvedValue({
      id: 9,
      name: "CI",
      created_at: "2026-07-12T09:00:00Z",
      last_used_at: null,
      token: "pil_copy_me",
    });
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/Token name/), {
      target: { value: "CI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("pil_copy_me"));
    expect(
      await screen.findByRole("button", { name: "Copied!" }),
    ).toBeInTheDocument();
  });

  it("revokes a token", async () => {
    vi.mocked(getTokens).mockResolvedValue([EXISTING]);
    vi.mocked(deleteToken).mockResolvedValue({ ok: true });
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke MCP server" }),
    );

    await waitFor(() => expect(deleteToken).toHaveBeenCalled());
    expect(vi.mocked(deleteToken).mock.calls[0][0]).toBe(7);
  });

  it("shows an error when minting fails", async () => {
    vi.mocked(createToken).mockRejectedValue(new Error("500 boom"));
    renderCard();

    fireEvent.change(screen.getByPlaceholderText(/Token name/), {
      target: { value: "CI" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText(/Couldn't create the token/)).toBeInTheDocument();
  });
});
