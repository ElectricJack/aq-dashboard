import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../../mocks/handlers";
import { SERVER_TIME, SESSIONS } from "../../../mocks/inspectionData";
import { renderApp } from "../../../test/renderApp";
import { notificationDetail, notificationRecipient, notificationRow, notifyId } from "../../../test/notificationInspection";
import { waitDetail, waitId, waitRow } from "../../../test/waitInspection";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ATTEMPT = "att-00000000-0000-0000-0000-000000000105";
const PROJECT = notifyId(2);
type Options = { permissions?: string[]; controller?: { state: "none" | "held"; label: string | null }; generation?: string | null; capabilities?: string[]; lastOutputAt?: string | null };
function setup(o: Options = {}) {
  const s = { ...SESSIONS[0]!, project: { id: PROJECT, label: "Ops project" }, attempt_id: ATTEMPT, terminal: null,
    permissions: o.permissions ?? SESSIONS[0]!.permissions, controller: o.controller ?? SESSIONS[0]!.controller,
    last_output_at: o.lastOutputAt === undefined ? "2026-10-31T11:59:58.000Z" : o.lastOutputAt,
    session_identity: o.generation === null ? null : { kind: "central", session_id: SESSIONS[0]!.id, generation: o.generation ?? "7" } };
  const caps = (o.capabilities ?? []).map(name => ({ name, version: "1", enabled: true }));
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: notificationRecipient },
      capabilities: [...bootstrap.data.capabilities.filter(c => !caps.some(x => x.name === c.name)), ...caps] } })),
    http.get("/api/v1/sessions/:id", () => HttpResponse.json({ api_version: "proposed-0", request_id: "ops", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, coverage: { state: "complete" }, data: s })),
  );
  return renderApp(`/agents/${s.id}`);
}
async function view(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Session details" }));
  const nav = await screen.findByRole("navigation", { name: "Session operations" });
  await userEvent.click(within(nav).getByRole("button", { name }));
  return screen.findByRole("region", { name });
}

test("profile view separates revisions, harness, provenance and effective from requested permissions", async () => {
  setup();
  const profile = await view("Profile");
  expect(within(profile).getByRole("list", { name: "Profile revisions" })).toHaveTextContent("agent profile · revision 4");
  expect(profile).toHaveTextContent("claude-opus-5-5 · claude-code");
  expect(profile).toHaveTextContent("Instruction provenance not reported by this AQ server");
  expect(within(profile).getByRole("list", { name: "Effective permissions" })).toHaveTextContent("run tests");
  expect(profile).toHaveTextContent("Requested permissions not reported by this AQ server");
});

test("health shows each observation with its own time and no invented stall rung", async () => {
  setup();
  const health = await view("Health");
  const rows = within(health).getByRole("list", { name: "Health observations" });
  expect(within(rows).getByText("Heartbeat").closest("li")).toHaveTextContent(/observed \d+s ago/);
  expect(within(rows).getByText("Provider output").closest("li")).toHaveTextContent("2s ago");
  expect(within(rows).getByText("Semantic progress").closest("li")).toHaveTextContent("Not reported by this AQ server");
  expect(within(rows).getByText("Wait observation").closest("li")).toHaveTextContent("No wait observed");
  expect(health).toHaveTextContent("Stall state unavailable on this AQ server");
  expect(health).not.toHaveTextContent(/rung \d/i);
});

test("nudge without a session.nudge permission is unsupported and sends nothing", async () => {
  let posts = 0; server.use(http.post("/api/v1/actions", () => { posts++; return HttpResponse.json({}); }));
  setup();
  const health = await view("Health");
  expect(within(health).getByText("Nudge unsupported")).toBeInTheDocument();
  expect(within(health).queryByRole("button", { name: "Send nudge" })).toBeNull();
  expect(posts).toBe(0);
});

function confirmed(body: { operation_id: string }) {
  return { api_version: "dashboard-actions-1", data: { operation_id: body.operation_id, disposition: "confirmed", request_digest: `sha256:${"d".repeat(64)}`, scope: { kind: "project", project_id: PROJECT },
    subject_refs: [{ type: "session", id: SESSIONS[0]!.id, revision: "7" }], receipt_refs: [{ type: "nudge", id: "n-1", revision: "1" }], affected_entities: [], recovery: "none",
    created_at: SERVER_TIME, updated_at: SERVER_TIME } };
}

test("nudge posts an H3 session.nudge action, re-sends identical bytes after an unknown outcome, and never writes to the terminal", async () => {
  const bodies: string[] = []; let terminalWrites = 0;
  server.use(
    http.post("/api/v1/actions", async ({ request }) => { const text = await request.text(); bodies.push(text); return bodies.length === 1 ? HttpResponse.error() : HttpResponse.json(confirmed(JSON.parse(text))); }),
    http.post("/api/v1/terminals/*", () => { terminalWrites++; return HttpResponse.json({}); }),
  );
  setup({ permissions: ["session.inspect", "session.nudge"] });
  const health = await view("Health");
  await userEvent.type(within(health).getByRole("textbox", { name: "Nudge message" }), "Please post a progress note");
  await userEvent.click(within(health).getByRole("button", { name: "Send nudge" }));
  expect(await within(health).findByText("Nudge outcome unknown")).toBeInTheDocument();
  const sent = JSON.parse(bodies[0]!);
  expect(sent).toMatchObject({ kind: "session.nudge", subject: { type: "session", id: SESSIONS[0]!.id, revision: "7" }, expected_versions: { session: "7" },
    payload: { project_id: PROJECT, expected_generation: "7", body: "Please post a progress note" } });
  expect(sent.payload.operation_id).toBe(sent.operation_id);
  await userEvent.click(within(health).getByRole("button", { name: "Re-send same nudge" }));
  expect(await within(health).findByText("Nudge queued")).toBeInTheDocument();
  expect(bodies[1]).toBe(bodies[0]);
  expect(terminalWrites).toBe(0);
});

test("a confirmed nudge to a human-controlled pane is deferred to the inbox", async () => {
  server.use(http.post("/api/v1/actions", async ({ request }) => HttpResponse.json(confirmed(await request.json() as { operation_id: string }))));
  setup({ permissions: ["session.nudge"], controller: { state: "held", label: "Sample Owner" } });
  const health = await view("Health");
  await userEvent.type(within(health).getByRole("textbox", { name: "Nudge message" }), "Check in");
  await userEvent.click(within(health).getByRole("button", { name: "Send nudge" }));
  expect(await within(health).findByText("Nudge deferred")).toBeInTheDocument();
  expect(health).toHaveTextContent(/holds the nudge in the session inbox/);
});

test("waits_view_lists_registered_waits", async () => {
  let listReads = 0;
  server.use(
    http.get("/api/waits", () => { listReads++; return HttpResponse.json({ items: [waitRow(1, ATTEMPT), waitRow(2, "other-attempt")] }); }),
    http.get("/api/waits/:id", ({ params }) => HttpResponse.json(waitDetail(Number(String(params.id).slice(-12)), { holdReason: "project concurrency limit" }))),
  );
  setup();
  await screen.findByRole("button", { name: "Session details" });
  expect(listReads).toBe(0);
  const waits = await view("Waits");
  const list = await within(waits).findByRole("list", { name: "Registered waits" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(list).toHaveTextContent(waitId(1).slice(0, 8));
  await userEvent.click(within(list).getByRole("button", { name: /Inspect wait/ }));
  const detail = await within(waits).findByRole("region", { name: /^Wait 20000000/ });
  expect(detail).toHaveTextContent("All of 2 conditions");
  expect(detail).toHaveTextContent("resolves the edge, not the producer's success");
  expect(detail).toHaveTextContent("requires producer success");
  expect(detail).toHaveTextContent(`Verified result ${waitId(20)} · revision 7`);
  expect(detail).toHaveTextContent("Retained hibernation");
  expect(detail).toHaveTextContent(`Compute released · parking receipt ${waitId(10)} · revision 2`);
  expect(detail).toHaveTextContent(`Disk protected · parking report ${waitId(11)} · revision 3`);
  expect(detail).toHaveTextContent("Continuation generation 6");
  expect(detail).toHaveTextContent("project concurrency limit");
  expect(detail).toHaveTextContent(/Deadline .*2026/);
  expect(detail).toHaveTextContent("Cancelling a wait does not cancel the task");
});

test("waits separates warm, resume pending and running, and labels a manual early resume as an override", async () => {
  server.use(
    http.get("/api/waits", () => HttpResponse.json({ items: [waitRow(1, ATTEMPT), waitRow(2, ATTEMPT), waitRow(3, ATTEMPT)] })),
    http.get("/api/waits/:id", ({ params }) => {
      const n = Number(String(params.id).slice(-12));
      return HttpResponse.json(n === 1 ? waitDetail(1, { parked: false }) : n === 2 ? waitDetail(2, { continuation: { kind: "wake_admitted", admission_id: "a", successor: {}, offer_digest: "x" }, outcome: "manual_override" })
        : waitDetail(3, { continuation: { kind: "bootstrap_acknowledged", receipt: {} }, outcome: "satisfied" }));
    }),
  );
  setup();
  const waits = await view("Waits");
  const list = await within(waits).findByRole("list", { name: "Registered waits" });
  const buttons = within(list).getAllByRole("button", { name: /Inspect wait/ });
  await userEvent.click(buttons[0]!);
  expect(await within(waits).findByText("Warm waiting")).toBeInTheDocument();
  expect(waits).toHaveTextContent("Disk protection not reported");
  await userEvent.click(buttons[1]!);
  expect(await within(waits).findByText("Resume pending")).toBeInTheDocument();
  expect(waits).toHaveTextContent("Manual early resume (override)");
  await userEvent.click(buttons[2]!);
  expect(await within(waits).findByText("Running")).toBeInTheDocument();
});

test("waits are plainly unavailable when the AQ server has no wait inspection", async () => {
  server.use(http.get("/api/waits", () => new HttpResponse(null, { status: 404 })));
  setup();
  const waits = await view("Waits");
  expect(await within(waits).findByText("Waits unavailable on this AQ server")).toBeInTheDocument();
});

test("notifications show delivery facts separately, a missing route plainly, and retry an unknown delivery with duplicate risk", async () => {
  const unrouted = { ...notificationRow(2), external_state: "no_external_route" };
  const foreign = notificationRow(3); foreign.message.scope.project_id = notifyId(99);
  const retries: unknown[] = [];
  server.use(
    http.get("/api/notifications", () => HttpResponse.json({ items: [notificationRow(1), unrouted, foreign], next_after: null })),
    http.get("/api/notifications/:id", ({ params }) => HttpResponse.json(params.id === unrouted.message.message_id ? notificationDetail("queued", unrouted) : notificationDetail("delivery_unknown"))),
    http.post("/api/notifications/retry", async ({ request }) => { const body = await request.json() as Record<string, unknown>; retries.push(body); return HttpResponse.json({ delivery_id: body.delivery_id, record_revision: 3, duplicate_risk_retries: 2, status: { kind: "queued" } }); }),
  );
  setup({ capabilities: ["notifications.read"] });
  const panel = await view("Notifications");
  const list = await within(panel).findByRole("list", { name: "Project notifications" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  await userEvent.click(within(list).getByRole("button", { name: /Notification 2/ }));
  expect(await within(panel).findByText("No external route recorded for this message")).toBeInTheDocument();
  await userEvent.click(within(list).getByRole("button", { name: /Notification 1/ }));
  const delivery = await within(panel).findByRole("group", { name: /Delivery 10000000/ });
  expect(delivery).toHaveTextContent("Delivery unknown");
  expect(delivery).toHaveTextContent(`Route ${notifyId(60).slice(0, 8)}`);
  expect(delivery).toHaveTextContent("Attempts: 1");
  expect(delivery).toHaveTextContent("Transport receipt: none recorded");
  expect(delivery).toHaveTextContent("Not acknowledged");
  await userEvent.click(within(delivery).getByRole("button", { name: "Retry delivery" }));
  await userEvent.click(within(delivery).getByRole("checkbox", { name: /may deliver a duplicate/ }));
  await userEvent.click(within(delivery).getByRole("button", { name: "Confirm retry" }));
  expect(await within(delivery).findByText(/Possible duplicate/)).toBeInTheDocument();
  expect(retries).toHaveLength(1);
  expect(retries[0]).toMatchObject({ delivery_id: notifyId(50), expected_revision: 2, accept_duplicate_risk: true });
  expect(typeof (retries[0] as { operation_id: unknown }).operation_id).toBe("string");
  expect(panel).not.toHaveTextContent(/secret/i);
});

test("notifications without the capability stay unavailable and read nothing", async () => {
  let reads = 0; server.use(http.get("/api/notifications", () => { reads++; return HttpResponse.json({ items: [], next_after: null }); }));
  setup();
  const panel = await view("Notifications");
  expect(panel).toHaveTextContent("Notifications unavailable");
  await waitFor(() => expect(reads).toBe(0));
});
