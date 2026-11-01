import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { SERVER_TIME, SESSIONS } from "../../mocks/inspectionData";
import { renderApp } from "../../test/renderApp";
import { usageBinding, usageFixture, usageId } from "../../test/sessionUsage";
import type { UsageBinding } from "../../api/wire/sessionUsage";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function session(binding: UsageBinding, observationBinding: UsageBinding | null = binding) {
  return { ...SESSIONS[0]!, id: binding.session.session_id, label: `Usage worker ${binding.session.session_id.slice(-2)}`,
    project: { id: binding.project_id, label: "Usage project" }, task: { id: binding.task_id, title: "Usage task", type: "task" }, attempt_id: binding.attempt_id,
    session_identity: binding.session.kind === "remote" ? { ...binding.session, assignment_generation: String(binding.session.assignment_generation) } : { ...binding.session, generation: String(binding.session.generation) },
    observation_binding: observationBinding, terminal: null };
}
function setup(options: { enabled?: boolean; version?: string; binding?: UsageBinding; anchor?: UsageBinding | null } = {}) {
  const binding = options.binding ?? usageBinding();
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(cap => cap.name !== "session.usage.read"), { name: "session.usage.read", version: options.version ?? "1", enabled: options.enabled ?? true }] } })),
    http.get("/api/v1/sessions/:id", ({ params }) => {
      const b = params.id === usageBinding(2).session.session_id ? usageBinding(2) : binding;
      return HttpResponse.json({ api_version: "proposed-0", request_id: "session-usage", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, coverage: { state: "complete" }, data: session(b, options.anchor === null ? null : b) });
    }),
  );
  return renderApp(`/agents/${binding.session.session_id}`);
}
async function open() { await userEvent.click(await screen.findByRole("button", { name: "Session details" })); return screen.findByRole("region", { name: "Session usage" }); }

test("usage reads only on details open, preserves partial/unknown facts, and refreshes on reopen", async () => {
  let reads = 0;
  server.use(http.get("/api/observations/sessions/:attempt/usage", () => { reads++; return HttpResponse.json(usageFixture()); }));
  setup();
  await screen.findByRole("button", { name: "Session details" }); expect(reads).toBe(0);
  const usage = await open();
  await within(usage).findByText("Reported subtotal: 120 · partial");
  expect(within(usage).getByText("Unknown · not reported")).toBeInTheDocument();
  expect(within(usage).getByText(/Categories may overlap/)).toBeInTheDocument();
  expect(within(usage).queryByText(/total tokens/i)).toBeNull(); expect(reads).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: "Session details" }));
  expect(screen.queryByRole("region", { name: "Session usage" })).toBeNull();
  await open(); await waitFor(() => expect(reads).toBe(2));
});
test("revision zero means no accounting projection and never displays subtotal zeros", async () => {
  server.use(http.get("/api/observations/sessions/:attempt/usage", () => HttpResponse.json(usageFixture(usageBinding(), true))));
  setup(); const usage = await open();
  await within(usage).findByText("No accounting projection has been recorded for this session.");
  expect(within(usage).queryByText(/Reported subtotal/)).toBeNull();
  expect(within(usage).getByText("Unknown · not reported")).toBeInTheDocument();
});
test.each([{ enabled: false }, { version: "2" }, { anchor: null }])("no usage read without capability and exact independent binding %j", async options => {
  let reads = 0;
  server.use(http.get("/api/observations/sessions/:attempt/usage", () => { reads++; return HttpResponse.json(usageFixture()); }));
  setup(options); await userEvent.click(await screen.findByRole("button", { name: "Session details" }));
  expect(screen.getByText("Session usage unavailable for this session.")).toBeInTheDocument(); expect(reads).toBe(0);
});
test("a failed explicit refresh clears prior accounting values", async () => {
  let reads = 0;
  server.use(http.get("/api/observations/sessions/:attempt/usage", () => ++reads === 1 ? HttpResponse.json(usageFixture()) : new HttpResponse(null, { status: 503 })));
  setup(); const usage = await open(); await within(usage).findByText("Reported subtotal: 120 · partial");
  await userEvent.click(within(usage).getByRole("button", { name: "Refresh session usage" }));
  await within(usage).findByText("Session usage unavailable. No accounting values are shown.");
  expect(within(usage).queryByText(/Reported subtotal/)).toBeNull();
});
test("a different session identity retains the conservative global integrity fence", async () => {
  const raw = usageFixture(); if (raw.binding.session.kind !== "remote") throw new Error("fixture"); raw.binding.session.boot_id = usageId(999);
  server.use(http.get("/api/observations/sessions/:attempt/usage", () => HttpResponse.json(raw)));
  setup(); await userEvent.click(await screen.findByRole("button", { name: "Session details" }));
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(screen.queryByText(/Reported subtotal/)).toBeNull();
});
test("late accounting from the previous session cannot appear after switching", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get("/api/observations/sessions/:attempt/usage", async ({ params }) => {
    if (params.attempt === usageBinding().attempt_id) { await gate; return HttpResponse.json(usageFixture()); }
    const raw = usageFixture(usageBinding(2)); raw.known_category_subtotals[0] = 987;
    return HttpResponse.json(raw);
  }));
  const app = setup(); await open();
  await act(() => app.router.navigate(`/agents/${usageBinding(2).session.session_id}`));
  await screen.findByRole("region", { name: "Usage worker 72" }); await open();
  await screen.findByText("Reported subtotal: 987 · partial");
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(screen.queryByText("Reported subtotal: 120 · partial")).toBeNull());
});
