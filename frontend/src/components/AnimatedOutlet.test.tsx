import { useEffect, useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import AnimatedOutlet from "./AnimatedOutlet";

function Jump({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  );
}

function ScreenA() {
  return (
    <div>
      <span>screen-a</span>
      <Jump to="/b" label="go-to-b" />
    </div>
  );
}

function ScreenB() {
  return <span>screen-b</span>;
}

/** Counts its own mounts and holds a bit of state, like an open dialog. */
const mounts = { count: 0 };
function StatefulScreen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return (
    <div>
      <span>stateful-screen</span>
      <button type="button" onClick={() => setOpen(true)}>
        open-dialog
      </button>
      {open && <div role="dialog">dialog-open</div>}
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AnimatedOutlet />}>
          <Route path="/a" element={<ScreenA />} />
          <Route path="/b" element={<ScreenB />} />
          <Route path="/stateful" element={<StatefulScreen />} />
          <Route path="/start" element={<Jump to="/stateful" label="go-to-stateful" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AnimatedOutlet", () => {
  it("swaps screen content when the pathname changes", async () => {
    renderAt("/a");
    expect(screen.getByText("screen-a")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("go-to-b").click();
    });

    await waitFor(() => {
      expect(screen.queryByText("screen-a")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("screen-b")).toHaveLength(1);
  });

  it("mounts the next screen once, so state set as it appears survives the fade", async () => {
    // Regression: the leaving screen rendered a live <Outlet />, so the next
    // route mounted inside it first and again once the fade ended, dropping
    // anything opened in between (a dialog, a typed value).
    mounts.count = 0;
    renderAt("/start");

    await act(async () => {
      screen.getByText("go-to-stateful").click();
    });
    await waitFor(() => {
      expect(screen.queryByText("go-to-stateful")).not.toBeInTheDocument();
    });
    const opener = await screen.findByText("open-dialog");
    await act(async () => {
      opener.click();
    });

    // Let the leaving screen's fade (0.12s) finish, then check nothing remounted.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole("dialog")).toHaveTextContent("dialog-open");
    expect(mounts.count).toBe(1);
  });
});
