import { describe, it, expect } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useLocation } from "react-router-dom";

function AnimatedLayout() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        data-testid="route-host"
        data-pathname={location.pathname}
        exit={{ opacity: 0, transition: { duration: 0 } }}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}

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

describe("AnimatePresence route host (Shell navigation pattern)", () => {
  it("swaps screen content when the pathname changes", async () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <Routes>
          <Route element={<AnimatedLayout />}>
            <Route path="/a" element={<ScreenA />} />
            <Route path="/b" element={<ScreenB />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("screen-a")).toBeInTheDocument();
    expect(screen.getByTestId("route-host")).toHaveAttribute(
      "data-pathname",
      "/a",
    );

    await act(async () => {
      screen.getByText("go-to-b").click();
    });

    await waitFor(() => {
      expect(screen.queryByText("screen-a")).not.toBeInTheDocument();
    });
    expect(screen.getByText("screen-b")).toBeInTheDocument();
    await waitFor(() => {
      const hosts = screen.getAllByTestId("route-host");
      expect(hosts).toHaveLength(1);
      expect(hosts[0]).toHaveAttribute("data-pathname", "/b");
    });
  });
});
