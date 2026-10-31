import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fixture from "../../contracts/proposed/bootstrap.json";
import { renderApp } from "../test/renderApp";
import { handlersFor } from "../mocks/handlers";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function liveBootstrap(capabilities: string[]) {
  return {
    ...fixture, api_version: "dashboard-read-1",
    data: {
      ...fixture.data,
      product: { version: "0.1.0", dashboard_digest: null },
      capabilities: capabilities.map((name) => ({ name, version: "1", enabled: true })),
    },
  };
}

test("live capabilities gate unsupported pages and search without requesting them", async () => {
  let requested = false;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["sessions.read"]))),
    http.get("/api/v1/tasks", () => { requested = true; return HttpResponse.json({}); }),
  );
  renderApp("/work");
  expect(await screen.findByRole("heading", { name: "Work is not available" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Search/ })).toBeDisabled();
  expect(requested).toBe(false);
});

test("settings uses actual foundation status and worker response shapes", async () => {
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["workers.read", "status.read"]))),
    http.get("/api/status", () => HttpResponse.json({ health: "ok", version: {}, update: {} })),
    http.get("/api/workers", () => HttpResponse.json([
      { id: "node-1", name: "Desktop worker", worker_version: "0.3.3", status: "offline", last_seen_at: null },
    ])),
  );
  renderApp("/settings");
  const roster = await screen.findByRole("list", { name: "Worker nodes" });
  expect(within(roster).getByText("Desktop worker")).toBeInTheDocument();
  expect(roster).toHaveTextContent("offline");
  expect(roster).toHaveTextContent("Never reported");
  expect(await screen.findByText("Daemon: ok")).toBeInTheDocument();
});

test("authorized projects populate the scope picker and navigate without inventing labels", async () => {
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["projects.read"]))),
    http.get("/api/v1/projects", () => HttpResponse.json({
      ...fixture, api_version: "dashboard-read-1", data: {
        items: [{ id: "project-1", label: "Live project" }], next_cursor: null,
        has_more: false, snapshot_id: "current", total: { value: 1, accuracy: "exact" },
      },
    })),
  );
  const { router } = renderApp("/settings");
  expect(await screen.findByRole("option", { name: "Live project" })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "project:project-1");
  expect(router.state.location.search).toContain("project%3Aproject-1");
});

test("unsupported live contract versions fail before loading dashboard data", async () => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...liveBootstrap([]), api_version: "future-99" })));
  renderApp("/settings");
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
});
