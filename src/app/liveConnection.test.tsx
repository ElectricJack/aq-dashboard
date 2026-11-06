import { act, screen, waitFor, within } from "@testing-library/react";
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
      contracts: [{ name: "dashboard-read", version: "dashboard-read-1", digest: "sha256:fixture" }],
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

test("an older daemon without bootstrap reports a compatibility problem", async () => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ error: "not_found" }, { status: 404 })));
  renderApp("/settings");
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
});

test.each([401, 403])("resource %s clears private worker data even when bootstrap becomes unreachable", async (status) => {
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["workers.read"]))),
    http.get("/api/workers", () => HttpResponse.json([
      { id: "private-node", name: "Private worker name", worker_version: "1", status: "online", last_seen_at: null },
    ])),
  );
  const { queryClient } = renderApp("/settings");
  await screen.findByText("Private worker name");
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.error()),
    http.get("/api/workers", () => HttpResponse.json({}, { status })),
  );
  await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "aq" }));

  // A 403 whose bootstrap re-check cannot reach AQ fails closed, without claiming a sign-out.
  expect(await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access not confirmed" })).toBeInTheDocument();
  expect(screen.queryByText("Private worker name")).not.toBeInTheDocument();
  expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0);
  if (status === 403) {
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Access not confirmed" })).toBeInTheDocument();
    expect(screen.queryByText("Private worker name")).not.toBeInTheDocument();
    // Once AQ answers bootstrap, Try again leaves the gate instead of looping (QA §2A).
    server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["workers.read"]))));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access not confirmed" })).not.toBeInTheDocument();
  }
});

test("a session detail 403 stays in the detail view, drops its data and re-checks bootstrap once", async () => {
  let bootstrapReads = 0;
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(
    http.get("/api/v1/sessions/sess-07", () => HttpResponse.json({}, { status: 403 })),
    http.get("/api/v1/bootstrap", () => { bootstrapReads++; return HttpResponse.json(fixture); }),
  );
  await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "aq" && JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  expect(await screen.findByText("This item does not exist or is not available to you.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Worker 07" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Access denied" })).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  await waitFor(() => expect(bootstrapReads).toBe(1));
  const detail = queryClient.getQueryCache().findAll({ queryKey: ["aq"] }).filter(q => JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07"));
  expect(detail.every(q => q.state.data === undefined)).toBe(true);
});

test.each(["version", "scope"])("paged read rejects a mismatched %s before caching data", async (mismatch) => {
  server.use(http.get("/api/v1/sessions", () => HttpResponse.json({
    ...fixture, api_version: mismatch === "version" ? "future-99" : fixture.api_version,
    scope: mismatch === "scope" ? { kind: "project", project_id: "other-project" } : fixture.scope,
    data: { items: [], has_more: false, next_cursor: null, snapshot_id: "unexpected", total: { value: 0, accuracy: "exact" } },
  })));
  const { queryClient } = renderApp("/agents");
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0);
});

test("malformed bootstrap refresh gates and clears already loaded protected data", async () => {
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...fixture, data: {} })));
  await act(() => queryClient.refetchQueries({ queryKey: ["bootstrap"] }));
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0));
  expect(screen.queryByRole("region", { name: "Worker 07" })).not.toBeInTheDocument();
});

test.each(["version", "scope", "upgrade required"])("single read clears previously cached projects after a mismatched %s", async (mismatch) => {
  const projectEnvelope = { ...fixture, api_version: "dashboard-read-1", data: {
    items: [{ id: "private-project", label: "Private project label" }], next_cursor: null,
    has_more: false, snapshot_id: "current", total: { value: 1, accuracy: "exact" },
  } };
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(liveBootstrap(["projects.read"]))),
    http.get("/api/v1/projects", () => HttpResponse.json(projectEnvelope)),
  );
  const { queryClient } = renderApp("/settings");
  await screen.findByRole("option", { name: "Private project label" });
  server.use(http.get("/api/v1/projects", () => mismatch === "upgrade required" ? HttpResponse.json({}, { status: 426 }) : HttpResponse.json({
    ...projectEnvelope,
    ...(mismatch === "version" ? { api_version: "future-99" } : { scope: { kind: "project", project_id: "other" } }),
  })));
  await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "aq" }));
  if (mismatch === "upgrade required") {
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Dashboard version" })).toHaveTextContent("Install compatible versions, then reload.");
    expect(screen.queryByRole("heading", { name: "Dashboard update required" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Private project label" })).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ predicate: query => query.queryKey[0] === "aq" && query.queryKey[4] === "projects" }).every(query => query.state.data === undefined)).toBe(true);
    return;
  }
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Private project label" })).not.toBeInTheDocument();
  expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0);
});

test("unchanged background bootstrap cannot reopen a denied session", async () => {
  let deniedReads = 0;
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(http.get("/api/v1/sessions/sess-07", () => {
    deniedReads += 1;
    return HttpResponse.json({}, { status: 403 });
  }));
  await act(() => queryClient.refetchQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  await screen.findByText("This item does not exist or is not available to you.");
  await act(() => queryClient.refetchQueries({ queryKey: ["bootstrap"] }));
  expect(screen.getByText("This item does not exist or is not available to you.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Worker 07" })).not.toBeInTheDocument();
  expect(deniedReads).toBe(1);
});

test("fresh bootstrap sign-out takes priority over an older resource denial", async () => {
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(http.get("/api/v1/sessions/sess-07", () => HttpResponse.json({}, { status: 403 })));
  await act(() => queryClient.refetchQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  await screen.findByText("This item does not exist or is not available to you.");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({}, { status: 401 })));
  await act(() => queryClient.refetchQueries({ queryKey: ["bootstrap"] }));
  expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("missing envelope data is a compatibility failure, not an ordinary stale refresh", async () => {
  server.use(http.get("/api/v1/sessions", () => HttpResponse.json({ ...fixture, data: undefined })));
  const { queryClient } = renderApp("/agents");
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0);
});
