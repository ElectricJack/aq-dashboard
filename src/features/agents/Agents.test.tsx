import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SERVER_TIME, SESSIONS } from "../../mocks/inspectionData";
import type { SessionDetail } from "../../api/wire/proposed";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function roster() {
  return screen.findByRole("list", { name: "Sessions" });
}

test("roster rows show task, project, profile, observed state and controller", async () => {
  renderApp("/agents");
  const row = within(await roster()).getByRole("link", { name: "Worker 07" }).closest("li")!;
  expect(row).toHaveTextContent("Replay reconciliation");
  expect(row).toHaveTextContent("agent-queue");
  expect(row).toHaveTextContent("claude-opus-5-5 · claude-code");
  expect(row).toHaveTextContent("Running (reported)");
  expect(row).toHaveTextContent(/updated \d+s ago/);
  expect(row).toHaveTextContent("No controller");
  expect(row).toHaveTextContent("Central");
});

test("a held controller is named", async () => {
  renderApp("/agents");
  const row = within(await roster()).getByRole("link", { name: "Worker 12" }).closest("li")!;
  expect(row).toHaveTextContent("Controlled by Sample Owner");
});

test("a stale observation says so and keeps its age", async () => {
  renderApp("/agents");
  const rows = within(await roster()).getAllByRole("listitem");
  expect(rows.some((r) => /Stale, observed 5m ago/.test(r.textContent ?? ""))).toBe(true);
});

test("opening a session shows its metadata and an honest terminal placeholder", async () => {
  const { router } = renderApp("/agents");
  await userEvent.click(within(await roster()).getByRole("link", { name: "Worker 07" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-07"));
  const detail = await screen.findByRole("region", { name: "Worker 07" });
  expect(within(detail).getByText(/terminal is not available/i)).toBeInTheDocument();
  expect(within(detail).getByText(/Not offered by this AQ server/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Worker 07" })).toHaveFocus());
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  expect(within(detail).getByRole("list", { name: "Profile revisions" })).toHaveTextContent("agent profile · revision 4");
  expect(within(detail).getByRole("list", { name: "Permissions" })).toHaveTextContent("run tests");
  expect(within(detail).getByRole("link", { name: "Replay reconciliation" })).toHaveAttribute("href", "/work/aq-104");
});

test("an unknown session is a neutral unavailable message", async () => {
  renderApp("/agents/nope-session");
  expect(await screen.findByText(/does not exist or is not available/i)).toBeInTheDocument();
  expect(screen.queryByText(/nope-session/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All sessions" })).toHaveAttribute("href", "/agents");
});

test("a failed roster read is an error, not an empty roster", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/agents");
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load sessions/i);
  expect(screen.queryByText("No active sessions")).not.toBeInTheDocument();
});

test("an empty complete roster says there are no sessions", async () => {
  server.use(...handlersFor("empty"));
  renderApp("/agents");
  expect(await screen.findByText("No active sessions")).toBeInTheDocument();
});

test("task detail links to the running session", async () => {
  const { router } = renderApp("/work/aq-104");
  await userEvent.click(await screen.findByRole("link", { name: "Open session" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-07"));
});

test("Back from a session returns focus to its roster row", async () => {
  const { router } = renderApp("/agents");
  await userEvent.click(within(await roster()).getByRole("link", { name: "Worker 12" }));
  await screen.findByRole("heading", { level: 2, name: "Worker 12" });
  await router.navigate(-1);
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Sessions" })).getByRole("link", { name: "Worker 12" })).toHaveFocus());
});

function nativeLifecycleSession(lifecycle: SessionDetail["lifecycle"]): SessionDetail {
  return { ...SESSIONS[0]!, observation: { state: "unknown", observed_at: SERVER_TIME, fresh_until: SERVER_TIME }, execution_authority: "finished", lifecycle };
}
function useLifecycleResponse(value: SessionDetail) {
  const envelope = (data: unknown) => ({ api_version: "proposed-0", request_id: "lifecycle", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, data, observation: { observed_at: SERVER_TIME, fresh_until: SERVER_TIME, source: "worker_receipts", quality: "reported", coverage: "complete" }, pending_operations: [], coverage: { state: "complete" } });
  server.use(
    http.get("/api/v1/sessions", () => HttpResponse.json(envelope({ items: [value], next_cursor: null, has_more: false, snapshot_id: "lifecycle", total: { value: 1, accuracy: "exact" } }))),
    http.get("/api/v1/sessions/:id", () => HttpResponse.json(envelope(value))),
  );
}

test("native lifecycle is visible in roster and peek while live state and terminal stay unknown", async () => {
  useLifecycleResponse(nativeLifecycleSession({ started_at: "2026-10-31T11:58:00.000Z", stopped_at: "2026-10-31T11:59:00.000Z" }));
  const { router } = renderApp("/agents");
  const row = within(await roster()).getByRole("listitem");
  expect(row).toHaveTextContent("State unknown");
  expect(row).toHaveTextContent("Central state: Finished");
  expect(row).toHaveTextContent("Start recorded 2m ago");
  expect(row).toHaveTextContent("Stop recorded 1m ago");
  expect(row).not.toHaveTextContent("Running (reported)");
  await userEvent.click(within(row).getByRole("link"));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/agents/${SESSIONS[0]!.id}`));
  const detail = await screen.findByRole("region", { name: SESSIONS[0]!.label });
  expect(detail).toHaveTextContent("Start recorded 2m ago");
  expect(detail).toHaveTextContent("Stop recorded 1m ago");
  expect(within(detail).getByText(/historical evidence/)).toBeInTheDocument();
  expect(within(detail).getByText("Terminal is not available")).toBeInTheDocument();
  expect(within(detail).getByText("Configured provider")).toBeInTheDocument();
});

test("an implemented lifecycle read with no reports stays explicitly empty", async () => {
  useLifecycleResponse(nativeLifecycleSession({ started_at: null, stopped_at: null }));
  renderApp("/agents");
  const row = within(await roster()).getByRole("listitem");
  expect(row).toHaveTextContent("No worker lifecycle reports");
  expect(row).toHaveTextContent("State unknown");
  expect(row).not.toHaveTextContent("Stop recorded");
});


test("focused workspace switches real sessions and keeps metadata behind explicit disclosure", async () => {
  const { router } = renderApp("/agents/sess-07");
  const detail = await screen.findByRole("region", { name: "Worker 07" });
  expect(within(detail).getByRole("button", { name: "Session details" })).toHaveAttribute("aria-expanded", "false");
  expect(within(detail).queryByRole("list", { name: "Permissions" })).not.toBeInTheDocument();
  const switcher = await screen.findByRole("navigation", { name: "Session switcher" });
  await waitFor(() => expect(within(switcher).getByRole("link", { name: "Worker 07" })).toHaveAttribute("aria-current", "page"));
  await userEvent.click(within(switcher).getByRole("link", { name: "Worker 12" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-12"));
  expect(await screen.findByRole("heading", { level: 2, name: "Worker 12" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Take control|Send message/ })).not.toBeInTheDocument();
});
