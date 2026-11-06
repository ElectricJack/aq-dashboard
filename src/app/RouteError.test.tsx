import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RouteError } from "./RouteError";

const reload = vi.fn();
beforeEach(() => {
  window.sessionStorage.clear();
  reload.mockClear();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
});
afterEach(() => vi.restoreAllMocks());

function renderFailing(error: Error) {
  const router = createMemoryRouter([{ path: "/", errorElement: <RouteError />, lazy: () => Promise.reject(error) }]);
  render(<RouterProvider router={router} />);
}

test("a failed chunk reloads once automatically", async () => {
  renderFailing(new TypeError("Failed to fetch dynamically imported module: /assets/overview-x.js"));
  expect(await screen.findByText("Updating dashboard…")).toBeInTheDocument();
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a repeat chunk failure shows the friendly state with Reload and details", async () => {
  window.sessionStorage.setItem("aq-dashboard:chunk-reload-at", String(Date.now()));
  renderFailing(new Error("Unable to preload CSS for /assets/overview-x.css"));
  expect(await screen.findByText(/dashboard was updated or the server is unreachable/)).toBeInTheDocument();
  expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  expect(reload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Details")).toBeInTheDocument();
});

test("other route errors show the message in a details disclosure without reloading", async () => {
  renderFailing(new Error("render exploded"));
  expect(await screen.findByText("Something went wrong showing this page.")).toBeInTheDocument();
  expect(screen.getByText("render exploded")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});
