import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "./client";

/** A minimal stand-in for a successful JSON `Response`. */
function okJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/** A failing `Response` whose body reads as `body`. */
function errResponse(status: number, statusText: string, body: string): Response {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("json (GET requests)", () => {
  it("returns the parsed body on a 2xx response", async () => {
    fetchMock.mockResolvedValue(okJson({ id: 1, username: "ada" }));
    await expect(api.getMe()).resolves.toEqual({ id: 1, username: "ada" });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", undefined);
  });

  it("throws status, statusText and body on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(errResponse(404, "Not Found", "no such user"));
    await expect(api.getMe()).rejects.toThrow("404 Not Found: no such user");
  });

  it("falls back to an empty body when the error body cannot be read", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.reject(new Error("stream error")),
    } as unknown as Response);
    await expect(api.getMe()).rejects.toThrow("500 Internal Server Error: ");
  });
});

describe("verb helpers", () => {
  it("POSTs a JSON body with the right content-type", async () => {
    fetchMock.mockResolvedValue(okJson({ id: 7 }));
    await api.createAccount({ name: "Cash", type: "checking" });
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cash", type: "checking" }),
    });
  });

  it("PUTs a JSON body", async () => {
    fetchMock.mockResolvedValue(okJson({ base_currency: "USD" }));
    await api.updatePrefs({ base_currency: "USD" });
    expect(fetchMock).toHaveBeenCalledWith("/api/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_currency: "USD" }),
    });
  });

  it("DELETEs without a body or content-type", async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    await api.deleteGoal(3);
    expect(fetchMock).toHaveBeenCalledWith("/api/goals/3", { method: "DELETE" });
  });
});

describe("getTransactions query building", () => {
  it("omits the query string entirely when no filters are given", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getTransactions();
    expect(fetchMock).toHaveBeenCalledWith("/api/transactions", undefined);
  });

  it("serialises only the provided filters, in a stable order", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getTransactions({ search: "coffee", sort: "amount" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transactions?search=coffee&sort=amount",
      undefined,
    );
  });

  it("includes account id 0 (null-check, not truthiness)", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getTransactions({ account: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transactions?account=0",
      undefined,
    );
  });

  it("includes pagination params when set", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getTransactions({ page: 2, per_page: 50 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/transactions?page=2&per_page=50",
      undefined,
    );
  });
});

describe("range / window query params", () => {
  it("defaults the net-worth range to 30D", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getNetWorthSeries();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history/networth?range=30D",
      undefined,
    );
  });

  it("passes an explicit net-worth range", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getNetWorthSeries("1Y");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/history/networth?range=1Y",
      undefined,
    );
  });

  it("defaults the history window to 90 days", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getAllHistory();
    expect(fetchMock).toHaveBeenCalledWith("/api/history/all?days=90", undefined);
  });

  it("defaults the projection horizon to 24 months", async () => {
    fetchMock.mockResolvedValue(okJson([]));
    await api.getProjections();
    expect(fetchMock).toHaveBeenCalledWith("/api/projections?months=24", undefined);
  });
});

describe("exportData", () => {
  const origCreateObjectURL = URL.createObjectURL;
  const origRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = origCreateObjectURL;
    URL.revokeObjectURL = origRevokeObjectURL;
  });

  function blobResponse(disposition: string | null): Response {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      blob: () => Promise.resolve(new Blob(["{}"], { type: "application/json" })),
      headers: { get: () => disposition },
    } as unknown as Response;
  }

  function stubDownload() {
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    let anchor: HTMLAnchorElement | undefined;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") anchor = el as HTMLAnchorElement;
      return el;
    });
    return { clickSpy, getAnchor: () => anchor };
  }

  it("throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(errResponse(403, "Forbidden", "nope"));
    await expect(api.exportData()).rejects.toThrow("403 Forbidden: nope");
  });

  it("downloads the blob using the Content-Disposition filename", async () => {
    fetchMock.mockResolvedValue(
      blobResponse('attachment; filename="piledger-2026.json"'),
    );
    const { clickSpy, getAnchor } = stubDownload();

    await api.exportData();

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(getAnchor()?.download).toBe("piledger-2026.json");
    expect(getAnchor()?.href).toContain("blob:fake-url");
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("uses a default filename when no Content-Disposition is present", async () => {
    fetchMock.mockResolvedValue(blobResponse(null));
    const { getAnchor } = stubDownload();

    await api.exportData();

    expect(getAnchor()?.download).toBe("piledger-export.json");
  });
});
