import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { SERVER_TIME, SESSIONS } from "../../mocks/inspectionData";
import { renderApp } from "../../test/renderApp";
import { eventsFixture } from "../../test/sessionEvents";
import { usageBinding } from "../../test/sessionUsage";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function setup(options: { enabled?: boolean; version?: string; anchor?: boolean } = {}) {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(cap => !["session.events.read", "session.usage.read"].includes(cap.name)),
    { name: "session.events.read", version: options.version ?? "1", enabled: options.enabled ?? true },
    { name: "session.usage.read", version: "1", enabled: false },
  ] } })), http.get("/api/v1/sessions/:id", ({ params }) => {
    const binding = params.id === usageBinding(2).session.session_id ? usageBinding(2) : usageBinding();
    return HttpResponse.json({ api_version: "proposed-0", request_id: "session-events", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, coverage: { state: "complete" },
      data: { ...SESSIONS[0]!, id: binding.session.session_id, label: `Events worker ${binding.session.session_id.slice(-2)}`, project: { id: binding.project_id, label: "Events project" },
        task: { id: binding.task_id, title: "Events task", type: "task" }, attempt_id: binding.attempt_id,
        session_identity: binding.session.kind === "remote" ? { ...binding.session, assignment_generation: String(binding.session.assignment_generation) } : { ...binding.session, generation: String(binding.session.generation) },
        observation_binding: options.anchor === false ? null : binding, terminal: null } });
  }));
  return renderApp(`/agents/${usageBinding().session.session_id}`);
}
async function details() {
  // Bootstrap mounts the shell before the session-detail read starts. Give
  // each visible readiness step its normal assertion deadline.
  await screen.findByRole("navigation", { name: "Primary" });
  await userEvent.click(await screen.findByRole("button", { name: "Session details" }));
}
async function load() { await details(); await userEvent.click(await screen.findByRole("button", { name: "Load source events" })); return screen.findByRole("region", { name: "Session source events" }); }

test("details retain focused output and only explicit Load reads source reports", async () => {
  let reads = 0;
  server.use(http.get("/api/observations/sessions/:attempt/events", async () => { reads++; return HttpResponse.json(await eventsFixture({ gap: true })); }));
  setup(); await details(); expect(reads).toBe(0);
  await userEvent.click(screen.getByRole("button", { name: "Load source events" }));
  const region = screen.getByRole("region", { name: "Session source events" });
  await within(region).findByText("Source gap · truncated"); expect(reads).toBe(1);
  expect(screen.getByText("Terminal is not available")).toBeInTheDocument();
  await userEvent.click(within(region).getByText("Source and identifiers"));
  expect(within(region).getByText("Source bytes unavailable · truncated")).toBeVisible();
});
test.each([{ enabled: false }, { version: "2" }, { anchor: false }])("no source read without independent anchor and supported capability %j", async options => {
  let reads = 0; server.use(http.get("/api/observations/sessions/:attempt/events", () => { reads++; return HttpResponse.json({}); }));
  setup(options); await details(); expect(screen.queryByRole("button", { name: "Load source events" })).toBeNull(); expect(reads).toBe(0);
});
test("empty retained snapshot is explicit and never claims a complete transcript", async () => {
  server.use(http.get("/api/observations/sessions/:attempt/events", async () => HttpResponse.json(await eventsFixture({ empty: true, through: 0 }))));
  setup(); const region = await load();
  await within(region).findByText("No source reports were recorded for this session in this retained snapshot.");
  expect(within(region).getByText(/not proof of a complete transcript/)).toBeInTheDocument();
});
test("four pages keep one snapshot and show explicit remaining reports", async () => {
  const cursors: string[] = [];
  server.use(http.get("/api/observations/sessions/:attempt/events", async ({ request }) => {
    const params = new URL(request.url).searchParams, after = Number(params.get("after_sequence")); cursors.push(params.toString());
    expect(params.get("limit")).toBe("16"); if (after > 0) expect(params.get("through_sequence")).toBe("8");
    return HttpResponse.json(await eventsFixture({ sequence: after + 1, after, through: 8, more: true }));
  }));
  setup(); const region = await load();
  await within(region).findByText("1 reports loaded · through node sequence 8");
  for (let count = 2; count <= 4; count++) { await userEvent.click(within(region).getByRole("button", { name: "Load more source events" })); await within(region).findByText(`${count} reports loaded · through node sequence 8`); }
  expect(within(region).getByText("Four pages loaded. Additional reports are not shown.")).toBeInTheDocument();
  expect(within(region).queryByRole("button", { name: "Load more source events" })).toBeNull(); expect(cursors).toHaveLength(4);
});
test("refresh fences a late previous snapshot page without mixing its rows", async () => {
  let release!: () => void, firsts = 0, pageRequested = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get("/api/observations/sessions/:attempt/events", async ({ request }) => {
    if (new URL(request.url).searchParams.get("after_sequence") === "1") { pageRequested = true; await gate; return HttpResponse.json(await eventsFixture({ sequence: 2, after: 1, through: 2 })); }
    firsts++;
    return HttpResponse.json(await eventsFixture(firsts === 1 ? { through: 2, more: true } : { sequence: 9, gap: true }));
  }));
  setup(); const region = await load(); await within(region).findByText("Tool started · fixture-tool");
  await userEvent.click(within(region).getByRole("button", { name: "Load more source events" })); await waitFor(() => expect(pageRequested).toBe(true));
  await userEvent.click(within(region).getByRole("button", { name: "Refresh snapshot" })); await within(region).findByText("Source gap · truncated");
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(within(region).queryByText("Tool started · fixture-tool")).toBeNull());
  expect(within(region).getByText("1 reports loaded · through node sequence 9")).toBeInTheDocument();
});
test("failed refresh removes older reports instead of showing stale success", async () => {
  let reads = 0; server.use(http.get("/api/observations/sessions/:attempt/events", async () => ++reads === 1 ? HttpResponse.json(await eventsFixture()) : new HttpResponse(null, { status: 503 })));
  setup(); const region = await load(); await within(region).findByText("Tool started · fixture-tool");
  await userEvent.click(within(region).getByRole("button", { name: "Refresh snapshot" }));
  await within(region).findByText("Source events unavailable. No reports are shown."); expect(within(region).queryByText("Tool started · fixture-tool")).toBeNull();
});
test.each([401, 403])("authorization refusal %i clears prior reports even while bootstrap is offline", async status => {
  server.use(http.get("/api/observations/sessions/:attempt/events", async () => HttpResponse.json(await eventsFixture())));
  setup(); const region = await load(); await within(region).findByText("Tool started · fixture-tool");
  server.use(http.get("/api/v1/bootstrap", () => new HttpResponse(null, { status: 503 })), http.get("/api/observations/sessions/:attempt/events", () => new HttpResponse(null, { status })));
  await userEvent.click(within(region).getByRole("button", { name: "Refresh snapshot" }));
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" }); expect(screen.queryByText("Tool started · fixture-tool")).toBeNull();
});
test("late reports from a different session never appear after navigation", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get("/api/observations/sessions/:attempt/events", async ({ params }) => {
    if (params.attempt === usageBinding().attempt_id) { await gate; return HttpResponse.json(await eventsFixture()); }
    return HttpResponse.json(await eventsFixture({ binding: usageBinding(2), gap: true }));
  }));
  const app = setup(); await load(); await act(() => app.router.navigate(`/agents/${usageBinding(2).session.session_id}`));
  await screen.findByRole("region", { name: "Events worker 72" }); const region = await load(); await within(region).findByText("Source gap · truncated");
  await act(async () => { release(); await gate; }); expect(screen.queryByText("Tool started · fixture-tool")).toBeNull();
});
