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
beforeEach(() => sessionStorage.clear());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function roster() {
  return screen.findByRole("list", { name: "Sessions" });
}

test("roster rows show task, project, profile, observed state and controller", async () => {
  renderApp("/agents");
  const row = within(await roster()).getByRole("link", { name: "Worker 07" }).closest("li")!;
  expect(row).toHaveTextContent("Fixture: Replay reconciliation");
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
  expect(within(detail).getAllByText(/Not offered by this AQ server/).length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Worker 07" })).toHaveFocus());
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  await userEvent.click(within(within(detail).getByRole("navigation", { name: "Session operations" })).getByRole("button", { name: "Profile" }));
  expect(within(detail).getByRole("list", { name: "Profile revisions" })).toHaveTextContent("agent profile · revision 4");
  expect(within(detail).getByRole("list", { name: "Effective permissions" })).toHaveTextContent("run tests");
  expect(within(detail).getByRole("link", { name: "Fixture: Replay reconciliation" })).toHaveAttribute("href", "/work/00000000-0000-0000-0000-000000000105?scope=project%3Aagent-queue");
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

test("Graph task inspection reports unavailable execution observation without a fabricated session", async () => {
  renderApp("/work/00000000-0000-0000-0000-000000000003?scope=project:00000000-0000-0000-0000-000000000001");
  expect(await screen.findByText("No agent attempt holds this task.")).toBeVisible();
  expect(screen.queryByRole("link",{name:"Open session"})).not.toBeInTheDocument();
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
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  expect(within(detail).getByRole("dialog", { name: "Session details" })).toBeInTheDocument();
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
  expect(within(detail).queryByRole("list", { name: "Effective permissions" })).not.toBeInTheDocument();
  expect(within(detail).getByRole("button", { name: "Message" })).toBeDisabled();
  // The fixture bootstrap doesn't advertise session messages, so Message says the server's own reason (RA-14).
  expect(within(detail).getByRole("button", { name: "Message" })).toHaveAccessibleDescription("Not offered by this AQ server");
  const switcher = await screen.findByRole("navigation", { name: "Session switcher" });
  await waitFor(() => expect(within(switcher).getByRole("link", { name: "Worker 07" })).toHaveAttribute("aria-current", "page"));
  expect(within(switcher).queryByRole("link", { name: "Worker 12" })).not.toBeInTheDocument();
  await userEvent.click(within(switcher).getByRole("button", { name: /^Sessions/ }));
  const options = within(switcher).getByRole("listbox", { name: "Sessions" });
  await userEvent.click(await within(options).findByRole("option", { name: /Worker 12/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-12"));
  expect(await screen.findByRole("heading", { level: 2, name: "Worker 12" })).toBeInTheDocument();
  const tabs = screen.getByRole("navigation", { name: "Session switcher" });
  expect(within(tabs).getByRole("link", { name: "Worker 12" })).toHaveAttribute("aria-current", "page");
  expect(within(tabs).getByRole("link", { name: "Worker 07" })).not.toHaveAttribute("aria-current");
  expect(screen.queryByRole("button", { name: /Take control|Send message/ })).not.toBeInTheDocument();
});

const UUID_SESSION = "00a14e33-3081-5704-89d4-743e936501ff";
function fallbackSession(extra: Partial<SessionDetail> = {}): SessionDetail {
  return { ...SESSIONS[0]!, id: UUID_SESSION, label: `Remote session ${UUID_SESSION}`, task: { type: "task", id: "e0a20000-0000-4000-8000-0000000001e1", revision: "1", title: "e0a20000-0000-4000-8000-0000000001e1" }, ...extra };
}

test("a session tab without a user label shows the short session id, not an identical prefix (RA-13)", async () => {
  useLifecycleResponse(fallbackSession());
  renderApp(`/agents/${UUID_SESSION}`);
  const switcher = await screen.findByRole("navigation", { name: "Session switcher" });
  const tab = await within(switcher).findByRole("link", { name: `Remote session ${UUID_SESSION}` });
  expect(tab).toHaveTextContent("Session 00a14e33");
  // "+" sits outside the scrolling tab row so it can't scroll away.
  const add = within(switcher).getByRole("button", { name: "Open another session" });
  expect(add.parentElement).toBe(switcher);
});

test("a session whose task title is recorded shows that title in its tab (RA-13)", async () => {
  useLifecycleResponse(fallbackSession({ task: { type: "task", id: "e0a20000-0000-4000-8000-0000000001e1", revision: "1", title: "Add hello()" } }));
  renderApp(`/agents/${UUID_SESSION}`);
  const switcher = await screen.findByRole("navigation", { name: "Session switcher" });
  expect(await within(switcher).findByRole("link", { name: `Remote session ${UUID_SESSION}` })).toHaveTextContent("Add hello()");
});

test("a session with no terminal says none was recorded (RA-17)", async () => {
  useLifecycleResponse(fallbackSession({ terminal: null }));
  renderApp(`/agents/${UUID_SESSION}`);
  expect(await screen.findByText("No terminal was recorded for this session.")).toBeVisible();
  expect(screen.queryByText(/not connected yet/)).toBeNull();
});

test("a partial roster states the server's reason and an empty line (RA-18)", async () => {
  const envelope = { api_version: "proposed-0", request_id: "partial", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, data: { items: [], next_cursor: null, has_more: false, snapshot_id: "p", total: { value: 0, accuracy: "exact" } }, observation: { observed_at: SERVER_TIME, fresh_until: SERVER_TIME, source: "x", quality: "reported", coverage: "partial" }, pending_operations: [], coverage: { state: "partial", reason: "Process activity, task titles, and wait details are not connected yet" } };
  server.use(http.get("/api/v1/sessions", () => HttpResponse.json(envelope)));
  renderApp("/agents");
  expect(await screen.findByText(/This roster has partial coverage\. Some sessions may be missing\. Process activity, task titles, and wait details are not connected yet\./)).toBeVisible();
  expect(screen.getByText("No sessions returned in this scope.")).toBeVisible();
});

test("Message is offered when the server advertises session messages and sends a mailbox action (RA-14)", async () => {
  const sent: Record<string, unknown>[] = [];
  const { default: bootstrap } = await import("../../../contracts/proposed/bootstrap.json");
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "session.message.enqueue"), { name: "session.message.enqueue", version: "1", enabled: true }] } })),
    http.post("/api/v1/actions", async ({ request }) => { const body = await request.json() as Record<string, unknown>; sent.push(body); return HttpResponse.json({ request_id: "r", code: "invalid_request", message: "Session mailbox is closed", retryable: false }, { status: 422 }); }),
  );
  useLifecycleResponse(fallbackSession({ permissions: ["session.inspect", "session.message.send"], session_identity: { kind: "remote", node_id: UUID_SESSION, boot_id: UUID_SESSION, attempt_id: UUID_SESSION, session_id: UUID_SESSION, assignment_generation: "3" } } as Partial<SessionDetail>));
  renderApp(`/agents/${UUID_SESSION}`);
  const message = await screen.findByRole("button", { name: "Message" });
  await waitFor(() => expect(message).toBeEnabled());
  await userEvent.click(message);
  const drawer = await screen.findByRole("dialog", { name: "Message" });
  await userEvent.type(within(drawer).getByLabelText("Message to the agent"), "Please rebase first.");
  await userEvent.click(within(drawer).getByRole("button", { name: "Send message" }));
  expect(await within(drawer).findByText("Session mailbox is closed")).toBeVisible();
  expect(sent[0]).toMatchObject({ kind: "session.message.send", subject: { type: "session", id: UUID_SESSION, revision: "3" }, payload: { expected_generation: "3", body: "Please rebase first." } });
  expect((sent[0]!.payload as { message_id: string }).message_id).not.toBe(sent[0]!.operation_id);
});
