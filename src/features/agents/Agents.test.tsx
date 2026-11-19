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

test("an unknown session is a neutral unavailable message", async () => {
  renderApp("/agents/nope-session");
  expect(await screen.findByText(/does not exist or is not available/i)).toBeInTheDocument();
  expect(screen.queryByText(/nope-session/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All sessions" })).toHaveAttribute("href", "/agents/history");
});

test("Graph task inspection reports unavailable execution observation without a fabricated session", async () => {
  renderApp("/work/00000000-0000-0000-0000-000000000003?scope=project:00000000-0000-0000-0000-000000000001");
  expect(await screen.findByText("No agent attempt holds this task.")).toBeVisible();
  expect(screen.queryByRole("link",{name:"Open session"})).not.toBeInTheDocument();
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

test("native lifecycle remains visible in session details", async () => {
  useLifecycleResponse(nativeLifecycleSession({ started_at: "2026-10-31T11:58:00.000Z", stopped_at: "2026-10-31T11:59:00.000Z" }));
  renderApp(`/agents/${SESSIONS[0]!.id}`);
  const detail = await screen.findByRole("region", { name: SESSIONS[0]!.label });
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  expect(within(detail).getByRole("dialog", { name: "Session details" })).toBeInTheDocument();
  expect(detail).toHaveTextContent("Start recorded 2m ago");
  expect(detail).toHaveTextContent("Stop recorded 1m ago");
  expect(within(detail).getByText(/historical evidence/)).toBeInTheDocument();
  expect(within(detail).getByText("Terminal is not available")).toBeInTheDocument();
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

test("session details say what the attempt ran with, and say nothing when the read has no record", async () => {
  const ranWith = { role: "developer", level: "standard-high", provider: "anthropic", model: "claude-sonnet-5", reasoning: "high", harness: "claude-code", execution_profile: "sandbox", snapshot_digest: null };
  useLifecycleResponse({ ...nativeLifecycleSession({ started_at: "2026-10-31T11:58:00.000Z", stopped_at: null }), ran_with: ranWith } as SessionDetail);
  renderApp(`/agents/${SESSIONS[0]!.id}`);
  const detail = await screen.findByRole("region", { name: SESSIONS[0]!.label });
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  const row = detail.querySelector("[data-session-ran-with]");
  expect(row).toHaveTextContent(/^developer · .+ · claude-sonnet-5 · high reasoning · claude-code$/);
  expect(within(detail).getByText("Ran with")).toBeInTheDocument();
});

test("session details without a ran_with record show no Ran with row", async () => {
  useLifecycleResponse(nativeLifecycleSession({ started_at: "2026-10-31T11:58:00.000Z", stopped_at: null }));
  renderApp(`/agents/${SESSIONS[0]!.id}`);
  const detail = await screen.findByRole("region", { name: SESSIONS[0]!.label });
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  expect(within(detail).getByRole("dialog", { name: "Session details" })).toBeInTheDocument();
  expect(within(detail).queryByText("Ran with")).toBeNull();
});

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


test("the session list and inspector label each observation state with a reason and relative times", async () => {
  // The session list is the history page; /agents is the terminal workspace.
  renderApp("/agents/history");
  const list = await screen.findByRole("list", { name: "Session history" });
  const row = (id: string) => list.querySelector<HTMLElement>(`li[data-session-id="${id}"]`)!;
  await waitFor(() => expect(row(SESSIONS[0]!.id)).not.toBeNull());
  expect(within(row(SESSIONS[0]!.id)).getByText("Working")).toBeInTheDocument();
  expect(row(SESSIONS[0]!.id)).toHaveTextContent("Last activity 3s ago · Last progress 1m ago");
  const quiet = row(SESSIONS[1]!.id);
  expect(within(quiet).getByText("No progress lately")).toHaveAccessibleDescription(/no progress lately\. No progress was seen within the evidence window\./i);
  expect(quiet).toHaveTextContent("Last progress 12m ago");
  const stale = row(SESSIONS[2]!.id);
  expect(within(stale).getByText("No recent activity")).toBeInTheDocument();
  expect(stale).toHaveTextContent("Nothing was observed within the start-up grace period");
  // An older payload without the added fields still renders its label and no activity line.
  expect(row(SESSIONS[3]!.id)).toHaveTextContent("Running (reported)");
  expect(row(SESSIONS[3]!.id)).not.toHaveTextContent("Last activity");
});

test("an unobserved session says why and shows no age; the inspector lists last activity and progress", async () => {
  const base = nativeLifecycleSession({ started_at: null, stopped_at: null });
  useLifecycleResponse({ ...base, observation: { ...base.observation, reason: "no_observation_source" } });
  renderApp(`/agents/${SESSIONS[0]!.id}`);
  const detail = await screen.findByRole("region", { name: SESSIONS[0]!.label });
  expect(within(detail).getByText("Not observed")).toHaveAccessibleDescription(/not being observed.*No observation source is reporting for this session\./);
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  const dialog = within(detail).getByRole("dialog", { name: "Session details" });
  expect(dialog).toHaveTextContent("No observation source is reporting for this session");
  expect(within(dialog).queryByText("Last progress")).toBeNull();
});

test("the inspector shows last activity and last progress from the observation", async () => {
  renderApp(`/agents/${SESSIONS[1]!.id}`);
  const detail = await screen.findByRole("region", { name: SESSIONS[1]!.label });
  expect(within(detail).getByText("No progress lately")).toBeInTheDocument();
  await userEvent.click(within(detail).getByRole("button", { name: "Session details" }));
  const dialog = within(detail).getByRole("dialog", { name: "Session details" });
  expect(within(dialog).getByText("Last activity").nextElementSibling).toHaveTextContent("3s ago");
  expect(within(dialog).getByText("Last progress").nextElementSibling).toHaveTextContent("12m ago");
  expect(within(dialog).getByText("Observation reason").nextElementSibling).toHaveTextContent("No progress was seen within the evidence window");
});
