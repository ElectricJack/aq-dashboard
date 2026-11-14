import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ParentDescriptionEditor, StructureDraftProvider } from "./IntelligenceStructureControls";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";

const registered = vi.hoisted(() => ({ entry: null as null | { save(): Promise<boolean>; locked: boolean; dirty: boolean } }));
vi.mock("./IntelligenceDrafts", () => ({ useIntelligenceDraft: (entry: typeof registered.entry) => { registered.entry = entry; return { saving: false }; } }));
vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
const path = "/api/settings/intelligence/structure";
const snapshot = () => ({ revision: "1", catalog_revision: "2", routing_markdown: "# Policy\n", parents: [
  { id: "simple", description: "Simple" }, { id: "standard", description: "Standard" }, { id: "complex", description: "Complex" }, { id: "deep", description: "Deep" },
], assignments: [{ profile_id: "profile", parent_id: "simple", effort: "low" }] });
const routingPath = "/api/settings/intelligence/routing";
const sourcePath = "/api/playbooks/sources/routing";
/** What the routing endpoint still answers after the decision table was removed: the switch, and nothing else. */
const switchState = (enabled = false) => ({ enabled, active: null, latest: null });
const bare = { id: "routing", kind: "builtin", binding: "aq.routing", active: null, latest: null };
const server = setupServer(
  http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "2", active_digest: null, profiles: [], model_choices: [] })),
  http.get(routingPath, () => HttpResponse.json(switchState())),
  http.get(sourcePath, () => HttpResponse.json(bare)),
  http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [], next_cursor: null })),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open(pollMs?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StructureDraftProvider><RoutingPolicyEditor pollMs={pollMs} /><ParentDescriptionEditor parent="standard" structure={snapshot() as Parameters<typeof ParentDescriptionEditor>[0]["structure"]} catalogRevision="2" busy={false} onBusy={() => {}} onSaved={async () => {}} onReload={async () => {}} /><button onClick={() => void registered.entry?.save()}>Save page</button></StructureDraftProvider></QueryClientProvider>);
  return client;
}

test("saves exact Markdown and preserves the snapshot captured on first edit across refresh", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...data, revision: "2", routing_markdown: submitted.routing_markdown, operation_id: submitted.operation_id, disposition: "saved" });
  }));
  const client = open(); const editor = await screen.findByLabelText("Markdown");
  fireEvent.change(editor, { target: { value: "  # Héllo\n\n" } });
  data = { ...data, revision: "2", parents: data.parents.map(p => ({ ...p, description: "changed" })) };
  await client.invalidateQueries();
  expect(editor).toHaveValue("  # Héllo\n\n");
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toMatchObject({ expected_revision: "2", expected_catalog_revision: "2", routing_markdown: "  # Héllo\n\n", parents: data.parents, assignments: snapshot().assignments });
});

test("conflict preserves the draft until explicit reload", async () => {
  let data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, () => HttpResponse.json({}, { status: 409 })));
  open(); const editor = await screen.findByLabelText("Markdown"); fireEvent.change(editor, { target: { value: "draft" } });
  data = { ...data, revision: "2", routing_markdown: "latest" };
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("edits are preserved"); expect(editor).toHaveValue("draft");
  expect(registered.entry?.locked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Reload structure settings" }));
  await waitFor(() => expect(editor).toHaveValue("latest"));
});

test("unknown save checks status then retries the exact operation", async () => {
  const requests: Record<string, unknown>[] = []; const data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ ...data, revision: "2", routing_markdown: body.routing_markdown, operation_id: body.operation_id, disposition: "saved" });
  }), http.get(`${path}/operations/:id`, () => HttpResponse.json({}, { status: 404 })));
  open(); fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same save" }));
  await screen.findByText("Structure saved."); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test("enforces the UTF-8 byte limit", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot()))); open();
  fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "é".repeat(65537) } });
  expect(screen.getByRole("alert")).toHaveTextContent("128 KiB"); expect(registered.entry?.locked).toBe(true);
});

test("combines description and policy drafts and clears a reverted field", async () => {
  const data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...data, revision: "2", parents: submitted.parents, routing_markdown: submitted.routing_markdown, operation_id: submitted.operation_id, disposition: "saved" });
  }));
  open(); const policy = await screen.findByLabelText("Markdown"); const description = screen.getByLabelText("Standard description");
  fireEvent.change(policy, { target: { value: "changed" } }); fireEvent.change(policy, { target: { value: data.routing_markdown } });
  expect(registered.entry?.dirty).toBe(false);
  fireEvent.change(policy, { target: { value: "policy" } }); fireEvent.change(description, { target: { value: "Updated" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toMatchObject({ routing_markdown: "policy", parents: expect.arrayContaining([expect.objectContaining({ id: "standard", description: "Updated" })]) });
});

const kase = (situation: string, result: string, passed = true) => ({ name: "steps.classify", situation, result, passed });
const active = (extra: Record<string, unknown> = {}) => ({ artifact: "sha256:" + "a".repeat(64), since_ms: 2_000, comparison: { change: "behaviour" },
  cases: [kase("a bug fix that failed once", "class: complex\neffort: high"), kase("a documentation fix", "class: simple\neffort: low")], ...extra });
const latest = (status: string, extra: Record<string, unknown> = {}) => ({ run: "r1", status, question: null, unable: null, refusal: null, internal_task_id: null, created_at_ms: Date.now() - 5_000, finished_at_ms: status === "running" ? null : Date.now(), ...extra });
const source = (extra: Record<string, unknown> = {}) => ({ ...bare, ...extra });
const useSource = (view: () => Record<string, unknown>) => server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json(view())));

test("says an agent turns saved changes into a playbook, and that the newest save wins", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot()))); open();
  expect(await screen.findByText(/An agent turns each saved version into a playbook/)).toBeVisible();
  expect(screen.getByText(/Saving again replaces a run still in progress/)).toBeVisible();
  expect(await screen.findByText("There is no playbook yet. Save the document and an agent will write one from it.")).toBeVisible();
  expect(screen.queryByText(/compile/i)).toBeNull();
});

test("a routing source that does not exist yet is the no playbook state, not an error", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json({ error: "not_found", message: "Source not found" }, { status: 404 }))); open();
  expect(await screen.findByText(/There is no playbook yet/)).toBeVisible();
  expect(screen.queryByText(/could not be loaded/)).toBeNull();
});

test("a source that cannot be read says so and leaves the document editable", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json({ error: "boom", message: "x" }, { status: 500 }))); open();
  expect(await screen.findByText("What the agent made of the document could not be loaded.")).toBeVisible();
  expect(screen.getByLabelText("Markdown")).toBeEnabled();
});

test("shows Writing the playbook… until the run finishes, then what the playbook does, and stops polling", async () => {
  let reads = 0;
  useSource(() => { reads++; return reads < 3 ? source({ latest: latest("running") }) : source({ active: active({ comparison: null }), latest: latest("saved") }); });
  open(20);
  expect(await screen.findByText("Writing the playbook…")).toBeVisible();
  const section = await screen.findByRole("region", { name: "What the playbook does" });
  expect(within(section).getByRole("table")).toHaveTextContent("a bug fix that failed once");
  expect(section).toHaveTextContent("class: complex effort: high");
  expect(section).toHaveTextContent("In effect since");
  expect(screen.queryByText("Writing the playbook…")).toBeNull();
  const settled = reads;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(reads).toBe(settled);
});

test("the agent's question is shown beside the editor, each sentence with its line, and the document stays editable", async () => {
  const question = { question: "Which sentence wins?", sentences: [{ line: 3, text: "Research is Standard." }, { line: 9, text: "Research is always Complex." }] };
  useSource(() => source({ active: active(), latest: latest("question", { question }) }));
  open();
  const asking = await screen.findByRole("region", { name: "The playbook needs an answer" });
  expect(asking).toHaveTextContent("Which sentence wins?");
  const items = within(asking).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Line 3Research is Standard.");
  expect(items[1]).toHaveTextContent("Line 9Research is always Complex.");
  const editor = screen.getByLabelText("Markdown");
  expect(asking.parentElement).toBe(editor.closest("div")!.parentElement);
  expect(screen.getAllByText("The playbook needs an answer")).toHaveLength(1);
  fireEvent.change(editor, { target: { value: "# Fixed" } });
  expect(editor).toHaveValue("# Fixed");
  expect(screen.getByText("The previous playbook is still in effect.")).toBeVisible();
});

test("a sentence that cannot be carried out, and a refusal, are shown in plain words", async () => {
  useSource(() => source({ latest: latest("unable", { unable: [{ sentence: "Art goes to the plotter.", line: 12, reason: "There is no plotter." }] }) }));
  const first = open();
  expect(await screen.findByText("This sentence cannot be carried out")).toBeVisible();
  expect(screen.getByText("Art goes to the plotter.")).toBeVisible();
  expect(screen.getByText("There is no plotter.")).toBeVisible();
  expect(screen.getByText("No playbook is in effect yet.")).toBeVisible();
  first.unmount();
  useSource(() => source({ active: active(), latest: latest("refused", { refusal: "The document asks for something that is not allowed." }) }));
  open();
  expect(await screen.findByText("The document asks for something that is not allowed.")).toBeVisible();
  expect(screen.getByText("The previous playbook is still in effect.")).toBeVisible();
});

test("the run is looked up by the source, and a superseded run is said to have been replaced", async () => {
  let asked: URLSearchParams | undefined;
  useSource(() => source({ active: active(), latest: latest("superseded") }));
  server.use(http.get("/api/internal-work/runs", ({ request }) => { asked = new URL(request.url).searchParams; return HttpResponse.json({ runs: [], next_cursor: null }); }));
  open();
  expect(await screen.findByText(/A newer save replaced this run/)).toBeVisible();
  await waitFor(() => expect(asked?.get("affected_kind")).toBe("playbook_source"));
  expect(asked?.get("affected_id")).toBe("routing");
});

test("saving while a run is in flight shows the newer run: the newest save wins", async () => {
  let saved = false; const saves: unknown[] = [];
  server.use(http.get(path, () => HttpResponse.json({ ...snapshot(), revision: saved ? "2" : "1" })), http.post(path, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; saves.push(body); saved = true;
    return HttpResponse.json({ ...snapshot(), revision: "2", routing_markdown: body.routing_markdown, operation_id: body.operation_id, disposition: "saved" });
  }), http.get(sourcePath, () => HttpResponse.json(source({ latest: latest("running", { run: saved ? "new" : "old", created_at_ms: saved ? Date.now() : Date.now() - 3_600_000 }) }))));
  open(20);
  expect(await screen.findByText(/Running for 60 min/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "# Newer" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(await screen.findByText(/Running for [0-5] s\./)).toBeVisible();
  expect(screen.queryByText(/Running for 60 min/)).toBeNull();
});

test("the switch is disabled until a playbook is active, then turns routing on", async () => {
  let view: Record<string, unknown> = bare; let enabled = false; let posted: unknown;
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json(view)), http.get(routingPath, () => HttpResponse.json(switchState(enabled))),
    http.post(routingPath, async ({ request }) => { posted = await request.json(); enabled = true; return HttpResponse.json(switchState(true)); }));
  const client = open();
  const toggle = await screen.findByRole("switch", { name: "Route tasks with this playbook" });
  expect(toggle).toBeDisabled(); expect(toggle).not.toBeChecked();
  view = source({ active: active(), latest: latest("saved") });
  await client.invalidateQueries();
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(posted).toEqual({ enabled: true });
});

test("when the server refuses to turn routing on, its own message is shown", async () => {
  useSource(() => source({ active: active(), latest: latest("saved") }));
  server.use(http.post(routingPath, () => HttpResponse.json({ error: "conflict", message: "Routing can be turned on once a routing playbook is active" }, { status: 409 })));
  open();
  await userEvent.click(await screen.findByRole("switch", { name: "Route tasks with this playbook" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Routing can be turned on once a routing playbook is active");
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).not.toBeChecked();
});

test("the switch can always be turned off", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(routingPath, () => HttpResponse.json(switchState(true))), http.post(routingPath, () => HttpResponse.json(switchState(false))));
  open();
  const toggle = await screen.findByRole("switch", { name: "Route tasks with this playbook" });
  await waitFor(() => expect(toggle).toBeChecked());
  expect(toggle).toBeEnabled();
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
});

test("rollback calls the API and refreshes the view", async () => {
  let rolledBack = 0;
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.get(sourcePath, () => HttpResponse.json(source({ active: active(rolledBack ? { comparison: null } : {}), latest: latest("saved") }))),
    http.post(`${sourcePath}/rollback`, () => { rolledBack++; return HttpResponse.json(bare); }));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Roll back to the previous playbook" }));
  await waitFor(() => expect(rolledBack).toBe(1));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Roll back to the previous playbook" })).toBeNull());
  expect(screen.getByText("There is no earlier playbook to compare it with.")).toBeVisible();
});

test("a refused rollback shows the server's words", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json(source({ active: active(), latest: latest("saved") }))),
    http.post(`${sourcePath}/rollback`, () => HttpResponse.json({ error: "conflict", message: "There is no previous playbook to roll back to." }, { status: 409 })));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Roll back to the previous playbook" }));
  expect(await screen.findByText("There is no previous playbook to roll back to.")).toBeVisible();
});

test("a very large report still shows the document, the playbook and the switch", async () => {
  const many = Array.from({ length: 5000 }, (_, i) => kase(`Situation ${i}`, "class: simple"));
  useSource(() => source({ active: active({ cases: many }), latest: latest("refused", { refusal: "e".repeat(300_000) }) }));
  open();
  expect(await screen.findByRole("region", { name: "What the playbook does" })).toBeVisible();
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).toBeEnabled();
  expect(screen.getByLabelText("Markdown")).toBeVisible();
});
