import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import task from "../../../contracts/live/human-graph/examples/task.json";
import { handlersFor } from "../../mocks/handlers";
import { FIXTURE_IDS } from "../../mocks/humanGraph";
import { renderApp } from "../../test/renderApp";
import { resetSectionMemory } from "./inspector/sections";

// A task's role (aq-server spec 0014 §5.5) in the task view, against the labelled fixtures: every fixture task runs as
// the project's default role `developer` ("Fixture developer"); "Replay reconciliation" has a running attempt, "Approve
// recovery plan" has none.
const server = setupServer(...handlersFor("default", { fixtures: true }));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.events.removeAllListeners(); server.resetHandlers(...handlersFor("default", { fixtures: true })); localStorage.clear(); resetSectionMemory(); });
afterAll(() => server.close());
const project = task.project.id, graph = `/api/human/projects/${project}/tasks`;
const fixtureId = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
async function open(id: string) {
  renderApp(`/work/${id}?scope=project:${project}`);
  const region = await screen.findByRole("region", { name: /^Fixture: / });
  await within(region).findByRole("heading", { name: "Status" });
  return region;
}
const status = (region: HTMLElement) => within(region).getByRole("button", { name: "Status" }).closest("section")!;
const menu = async (region: HTMLElement) => { await userEvent.click(await within(region).findByRole("button", { name: "More actions" })); return screen.getByRole("menu"); };
async function changeRole(region: HTMLElement) {
  await userEvent.click(within(await menu(region)).getByRole("menuitem", { name: "Change role" }));
  return screen.findByRole("dialog", { name: "Change role" });
}
function recordActions() {
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  server.events.on("request:start", async ({ request }) => { if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/actions") sent.push(await request.clone().json()); });
  return sent;
}
const work = (id: string, data: Record<string, unknown>) => http.get(`${graph}/${id}/work`, () => HttpResponse.json({ ...task, data: { task_id: id, task_state: "active", version: "1", parent: null, execution: null, readiness: { state: "ready", blockers: [], complete: true, reasons: [] }, ...data } }));

test("Status shows the role by its Settings name and where it comes from", async () => {
  const region = await open(FIXTURE_IDS.approve);
  const line = await waitFor(() => { const found = status(region).querySelector("[data-task-role]"); expect(found).toHaveTextContent("Role Fixture developer · project default"); return found!; });
  expect(line).toHaveAttribute("data-role-source", "project_default");
});

test("a role the task names reads as set on this task; a role Settings no longer has shows its id", async () => {
  server.use(work(FIXTURE_IDS.approve, { role: { id: "tester", source: "task" } }));
  const region = await open(FIXTURE_IDS.approve);
  await waitFor(() => expect(status(region).querySelector("[data-task-role]")).toHaveTextContent("Role tester · set on this task"));
});

test("Change role lists the enabled roles with the project default first, sends task.role.set, and Status then shows the new role", async () => {
  const sent = recordActions();
  const region = await open(FIXTURE_IDS.approve);
  const dialog = await changeRole(region);
  const select = within(dialog).getByRole("combobox", { name: "Role" });
  await waitFor(() => expect(within(select).getAllByRole("option").map(o => o.textContent)).toEqual(["Fixture developer (project default)", "Fixture developer", "Fixture reviewer"]));
  expect(select).toHaveValue("");
  expect(select).toHaveAccessibleDescription("The role is the kind of work. AQ's router chooses the level.");
  await userEvent.selectOptions(select, "reviewer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Role set to Fixture reviewer")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: "task.role.set", subject: { type: "task", id: FIXTURE_IDS.approve }, payload: { role: "reviewer", project_id: project, expected_version: expect.any(String), operation_id: expect.any(String) } });
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  await waitFor(() => expect(status(region).querySelector("[data-task-role]")).toHaveTextContent("Role Fixture reviewer · set on this task"));
  // Choosing the project default again sends no role, which clears the one the task names.
  const again = await changeRole(region);
  const role = within(again).getByRole("combobox", { name: "Role" });
  expect(role).toHaveValue("reviewer");
  await userEvent.selectOptions(role, "");
  await userEvent.click(within(again).getByRole("button", { name: "Submit" }));
  expect(await within(again).findByText("Role cleared; the project's default role applies")).toBeVisible();
  expect(sent[1]!.kind).toBe("task.role.set");
  expect(sent[1]!.payload).not.toHaveProperty("role");
});

test("Change role is not offered once an attempt has started, and says why", async () => {
  const sent = recordActions();
  const region = await open(FIXTURE_IDS.replay);
  await within(status(region)).findByText("Running");
  const item = within(await menu(region)).getByRole("menuitem", { name: /^Change role/ });
  expect(item).toHaveAttribute("aria-disabled", "true");
  expect(item).toHaveAccessibleDescription("The role is fixed once an attempt has started");
  await userEvent.click(item);
  expect(screen.queryByRole("dialog", { name: "Change role" })).toBeNull();
  expect(sent).toEqual([]);
});

test("an attempt that was only offered does not fix the role", async () => {
  server.use(work(FIXTURE_IDS.approve, { role: { id: "developer", source: "project_default" }, execution: { task_id: FIXTURE_IDS.approve, attempt_id: fixtureId(0x401), session_id: fixtureId(0x402), status: "offered" } }));
  const region = await open(FIXTURE_IDS.approve);
  expect(within(await menu(region)).getByRole("menuitem", { name: "Change role" })).not.toHaveAttribute("aria-disabled");
});

test("an unknown role is refused in AQ's words and the dialog stays open for another choice", async () => {
  const message = "Role `reviewer` does not exist. The roles are: developer.";
  server.use(http.post("/api/v1/actions", () => HttpResponse.json({ request_id: "fixture", code: "unknown_role", message, retryable: false }, { status: 422 })));
  const region = await open(FIXTURE_IDS.approve);
  const dialog = await changeRole(region);
  await userEvent.selectOptions(await within(dialog).findByRole("combobox", { name: "Role" }), "reviewer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
  expect(within(dialog).getByRole("status")).toHaveTextContent("Rejected — AQ refused this action.");
  // AQ gave its own reason, so the dashboard adds no guess of its own.
  expect(within(dialog).getByRole("status")).not.toHaveTextContent("until one of its attempts");
  expect(within(dialog).getByRole("button", { name: "Reload current versions" })).toBeVisible();
});

test("a rejected change (an attempt was granted meanwhile) says the role can no longer change", async () => {
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    const body = await request.json() as { operation_id: string; subject: unknown; payload: { project_id: string } };
    const stamp = new Date().toISOString(), scope = { kind: "project", project_id: body.payload.project_id };
    return HttpResponse.json({ api_version: "dashboard-actions-1", request_id: "fixture", server_time: stamp, scope, data: { operation_id: body.operation_id, disposition: "rejected", request_digest: `sha256:${"a".repeat(64)}`, scope,
      subject_refs: [body.subject], receipt_refs: [], affected_entities: [], recovery: "refresh_and_review", created_at: stamp, updated_at: stamp } });
  }));
  const region = await open(FIXTURE_IDS.approve);
  const dialog = await changeRole(region);
  await userEvent.selectOptions(await within(dialog).findByRole("combobox", { name: "Role" }), "reviewer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Rejected — AQ refused this action. AQ changes a task's role only until one of its attempts has been granted.")).toBeVisible();
});

test("a role hold reads Held with AQ's own sentence, and no claim about an attempt", async () => {
  const message = "AQ does not offer this task: its role `reviewer` is disabled. Enable the role in Settings or change the task's role.";
  server.use(work(FIXTURE_IDS.approve, { role: { id: "reviewer", source: "task" }, readiness: { state: "held", blockers: [], complete: true, reasons: [{ code: "role_disabled", role: "reviewer", message }] } }));
  const region = await open(FIXTURE_IDS.approve);
  expect(await within(region).findByText(/^Held/, { selector: "[data-task-status] span" })).toHaveTextContent("Held · its role is disabled");
  const reasons = within(status(region)).getByRole("list", { name: "Why the task is held" });
  expect(within(reasons).getByText(message)).toBeVisible();
  expect(reasons.querySelector("[data-hold-reason=role_disabled]")).not.toBeNull();
  expect(within(reasons).queryByRole("button", { name: "Copy held attempt ID" })).toBeNull();
  expect(within(status(region)).queryByText(/an attempt that has stopped or finished still holds it/)).toBeNull();
  expect(within(status(region)).queryByText("A stopped attempt still holds this task:")).toBeNull();
});

test("a missing role and a missing level are listed the same way", async () => {
  const role = "AQ does not offer this task: its role `tester` does not exist. Change the task's role or the project's default role.";
  const level = "AQ does not offer this task: the project's default intelligence profile `standard-high` does not exist. Add it in Settings or change the project's default.";
  for (const [code, reason, short] of [["role_missing", { role: "tester", message: role }, "its role does not exist"], ["level_missing", { level: "standard-high", message: level }, "its level does not exist"]] as const) {
    server.use(work(FIXTURE_IDS.approve, { role: { id: "tester", source: "task" }, readiness: { state: "held", blockers: [], complete: true, reasons: [{ code, ...reason }] } }));
    const view = renderApp(`/work/${FIXTURE_IDS.approve}?scope=project:${project}`);
    const region = await screen.findByRole("region", { name: /^Fixture: / });
    expect(await within(region).findByText(/^Held/, { selector: "[data-task-status] span" })).toHaveTextContent(`Held · ${short}`);
    expect(within(status(region)).getByText(reason.message)).toBeVisible();
    view.unmount();
  }
});

test("the holding attempt in Status shows what it ran with", async () => {
  const region = await open(FIXTURE_IDS.replay);
  const agent = await waitFor(() => { const found = status(region).querySelector<HTMLElement>("[data-holding-attempt]"); expect(found).not.toBeNull(); return found!; });
  const line = within(agent).getByText("Ran as developer · Standard · High · claude-opus-5-5 · high reasoning · claude-code").closest("[data-ran-with]")!;
  expect(line).toHaveAttribute("title", "Provider anthropic · execution profile fixture-sandbox · snapshot ffffffffffff");
});

test("an attempt from before roles has no such record, and Status shows none", async () => {
  server.use(work(FIXTURE_IDS.approve, { execution: { task_id: FIXTURE_IDS.approve, attempt_id: fixtureId(0x401), session_id: fixtureId(0x402), status: "running" }, readiness: { state: "running", blockers: [], complete: true, reasons: [] } }));
  const region = await open(FIXTURE_IDS.approve);
  await waitFor(() => expect(status(region).querySelector("[data-holding-attempt]")).not.toBeNull());
  expect(status(region).querySelector("[data-ran-with]")).toBeNull();
});

test("a refused offer reads Held with the startup text's two numbers, in the badge and under AQ's sentence", async () => {
  const message = "AQ does not offer this task: its startup text is 70112 bytes, over the limit of 65536 bytes (startup_context_bytes of execution profile `sandbox`). Shorten the task, the role or the project's notes, or raise that limit.";
  server.use(work(FIXTURE_IDS.approve, { role: { id: "developer", source: "project_default" }, readiness: { state: "held", blockers: [], complete: true, reasons: [
    { code: "startup_over_limit", bytes: 70112, limit: 65536, execution_profile: "sandbox", profile_limit: 65536, project_ceiling: 262144, limiting: "startup_context_bytes", message, recorded_at_ms: 1794000000000 }] } }));
  const region = await open(FIXTURE_IDS.approve);
  expect(await within(region).findByText(/^Held/, { selector: "[data-task-status] span" })).toHaveTextContent("Held · startup text over its limit (70,112 of 65,536 bytes)");
  const reason = within(status(region)).getByRole("list", { name: "Why the task is held" }).querySelector("[data-hold-reason=startup_over_limit]")!;
  expect(within(reason as HTMLElement).getByText(message)).toBeVisible();
  expect(reason.querySelector("[data-startup-over-limit]")).toHaveTextContent("Startup text 70,112 of 65,536 bytes · the limit is startup_context_bytes of execution profile sandbox");
  expect(within(status(region)).queryByText(/an attempt that has stopped or finished still holds it/)).toBeNull();
});

test("an environment without platform text, and the project's ceiling as the limit, are said the same way", async () => {
  const text = "AQ does not offer this task: the server has no platform text for environment `sandbox@3`, and an agent is not launched without it.";
  const over = "AQ does not offer this task: its startup text is 40000 bytes, over the limit of 32768 bytes (the project's context_bytes ceiling). Shorten the task, the role or the project's notes, or raise that limit.";
  server.use(work(FIXTURE_IDS.approve, { role: { id: "developer", source: "project_default" }, readiness: { state: "held", blockers: [], complete: true, reasons: [
    { code: "platform_text_missing", environment: "sandbox@3", message: text, recorded_at_ms: 1794000000000 },
    { code: "startup_over_limit", bytes: 40000, limit: 32768, execution_profile: "sandbox", profile_limit: 65536, project_ceiling: 32768, limiting: "project_context_bytes", message: over, recorded_at_ms: 1794000000000 }] } }));
  const region = await open(FIXTURE_IDS.approve);
  expect(await within(region).findByText(/^Held/, { selector: "[data-task-status] span" })).toHaveTextContent("Held · no platform text for its environment");
  expect(within(status(region)).getByText(text)).toBeVisible();
  expect(status(region).querySelector("[data-startup-over-limit]")).toHaveTextContent("Startup text 40,000 of 32,768 bytes · the limit is the project's context_bytes ceiling");
});

test("density: the role shares the route's line, and the holding attempt, its session and the terminal link share one", async () => {
  const region = await open(FIXTURE_IDS.replay);
  const role = await waitFor(() => { const found = status(region).querySelector("[data-task-role]"); expect(found).not.toBeNull(); return found!; });
  const line = role.parentElement!;
  expect(line.closest("[data-task-route]")).toHaveAttribute("data-task-route", "routed");
  expect([...line.children].map(child => child.textContent)).toEqual(["Role Fixture developer · project default", "Route Standard · High · lane backend"]);
  const agent = status(region).querySelector<HTMLElement>("[data-holding-attempt]")!;
  const head = within(agent).getByText("Agent attempt").closest("p")!;
  expect(within(head).getByRole("button", { name: "Copy attempt ID" })).toBeVisible();
  expect(within(head).getByRole("button", { name: "Copy session ID" })).toBeVisible();
  expect(within(head).getByRole("link", { name: "Open terminal" })).toBeVisible();
  // What it ran with is the one line under it.
  expect([...agent.children].map(child => child.tagName)).toEqual(["P", "P"]);
  expect(agent.children[1]).toHaveAttribute("data-ran-with");
});

test("a task with no route to show has its role on a line of its own", async () => {
  server.use(work(FIXTURE_IDS.approve, { role: { id: "developer", source: "project_default" }, routing: { state: "unrouted" } }));
  const region = await open(FIXTURE_IDS.approve);
  const role = await waitFor(() => { const found = status(region).querySelector("[data-task-role]"); expect(found).toHaveTextContent("Role Fixture developer · project default"); return found!; });
  expect(role.closest("[data-task-route]")).toBeNull();
});

test("the fixture project's binding names its default role and level, as a stored binding does on aq-server 09ee5e98", async () => {
  const response = await fetch(new URL(`/api/projects/${project}`, location.href));
  expect((await response.json()).binding).toMatchObject({ project_id: project, default_role: "developer", default_intelligence: "standard-high" });
});
