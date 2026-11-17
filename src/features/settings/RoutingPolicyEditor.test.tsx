import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { RoutingDocumentDraftProvider } from "./RoutingDocumentDraft";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";

const registered = vi.hoisted(() => ({ entry: null as null | { save(): Promise<boolean>; locked: boolean; dirty: boolean } }));
vi.mock("./IntelligenceDrafts", () => ({ useIntelligenceDraft: (entry: typeof registered.entry) => { registered.entry = entry; return { saving: false }; } }));
vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
// The routing document's own route: GET {markdown, revision}; PUT {markdown, expected_revision, operation_id} answers {revision, digest}.
const path = "/api/settings/routing-document";
const snapshot = () => ({ revision: "1", markdown: "# Policy\n" });
const receipt = (revision: string) => ({ revision, digest: "sha256:" + "a".repeat(64) });
const routingPath = "/api/settings/routing";
const sourcePath = "/api/playbooks/sources/routing";
/** The routing read of a server that does not fill `source`: the source is then read from the sources API, which is what most tests here drive. */
const switchState = (enabled = false) => ({ enabled, source: null });
const bare = { id: "routing", kind: "builtin", binding: "aq.routing", purpose: "Choose the intelligence level for each task", revision: 1, active: null, latest: null };
const server = setupServer(
  http.get(routingPath, () => HttpResponse.json(switchState())),
  http.get(sourcePath, () => HttpResponse.json(bare)),
  http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [], next_cursor: null })),
  http.get("/api/settings/profiles/limits", () => HttpResponse.json({ revision: "0", limits: { documents: { max_document_bytes: 65_536, max_set_bytes: 1_048_576, max_documents_per_kind: 128, max_name_bytes: 128, max_description_bytes: 2000 }, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 } })),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open(pollMs?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><RoutingDocumentDraftProvider><RoutingPolicyEditor pollMs={pollMs} /><button onClick={() => void registered.entry?.save()}>Save page</button></RoutingDocumentDraftProvider></QueryClientProvider>);
  return client;
}

test("saves exact Markdown and preserves the snapshot captured on first edit across refresh", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.put(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json(receipt("3"));
  }));
  const client = open(); const editor = await screen.findByLabelText("Markdown");
  fireEvent.change(editor, { target: { value: "  # Héllo\n\n" } });
  // Another settings change moved the store's revision; the text is the one the edit started from.
  data = { ...data, revision: "2" };
  await client.invalidateQueries();
  expect(editor).toHaveValue("  # Héllo\n\n");
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toEqual({ operation_id: expect.any(String), expected_revision: "2", markdown: "  # Héllo\n\n" });
});

test("conflict preserves the draft until explicit reload", async () => {
  let data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.put(path, () => HttpResponse.json({}, { status: 409 })));
  open(); const editor = await screen.findByLabelText("Markdown"); fireEvent.change(editor, { target: { value: "draft" } });
  data = { ...data, revision: "2", markdown: "latest" };
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("edits are preserved"); expect(editor).toHaveValue("draft");
  expect(registered.entry?.locked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Reload the routing document" }));
  await waitFor(() => expect(editor).toHaveValue("latest"));
});

test("checking an unknown save sends the exact operation again, which the server answers as the first time", async () => {
  const requests: Record<string, unknown>[] = []; const data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.put(path, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json(receipt("2"));
  }));
  open(); fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await screen.findByText("Routing document saved."); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test("enforces the store's limit for one document in UTF-8 bytes, and leaves the size to AQ when the limits cannot be read", async () => {
  // aq-server 09ee5e98 `aq-role-settings/src/store.rs`: the routing document is held to `limits.documents.max_document_bytes`.
  const documents = { max_document_bytes: 1000, max_set_bytes: 1_048_576, max_documents_per_kind: 128, max_name_bytes: 128, max_description_bytes: 2000 };
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get("/api/settings/profiles/limits", () => HttpResponse.json({ revision: "0", limits: { documents, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 } })));
  open();
  expect(await screen.findByText("9 / 1,000 bytes")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Markdown"), { target: { value: "é".repeat(501) } });
  expect(screen.getByRole("alert")).toHaveTextContent("at most 1,000 bytes"); expect(registered.entry?.locked).toBe(true);
  cleanup();
  server.use(http.get("/api/settings/profiles/limits", () => HttpResponse.json({ error: "internal", message: "no" }, { status: 500 })));
  open();
  fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "é".repeat(100_000) } });
  expect(await screen.findByText("200,000 bytes")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull(); expect(registered.entry?.locked).toBe(false);
});

test("the routing draft sends only its text, revision and operation id, and a reverted edit is not a change", async () => {
  const data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.put(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json(receipt("2"));
  }));
  open(); const policy = await screen.findByLabelText("Markdown");
  fireEvent.change(policy, { target: { value: "changed" } }); fireEvent.change(policy, { target: { value: data.markdown } });
  expect(registered.entry?.dirty).toBe(false);
  fireEvent.change(policy, { target: { value: "policy" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toEqual({ operation_id: expect.any(String), expected_revision: "1", markdown: "policy" });
});

const kase = (situation: string, result: string, passed = true) => ({ name: "steps.classify", situation, result, passed });
const active = (extra: Record<string, unknown> = {}) => ({ artifact: "sha256:" + "a".repeat(64), since_ms: 2_000, comparison: { change: "behaviour" }, can_rollback: true, previous: { since_ms: 1_000 },
  cases: [kase("a bug fix that failed once", "class: complex\neffort: high"), kase("a documentation fix", "class: simple\neffort: low")], ...extra });
const latest = (status: string, extra: Record<string, unknown> = {}) => ({ run: "7", status, question: null, unable: null, refusal: null, internal_task_id: null, created_at_ms: Date.now() - 5_000, finished_at_ms: status === "running" ? null : Date.now(), elapsed_ms: 5_000, ...extra });
const source = (extra: Record<string, unknown> = {}) => ({ ...bare, ...extra });
const useSource = (view: () => Record<string, unknown>) => server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json(view())));

test("says an agent turns saved changes into a playbook, and that the newest save wins", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot()))); open();
  expect(await screen.findByText(/An agent turns each saved version into a playbook/)).toBeVisible();
  expect(screen.getByText(/Saving again replaces a run still in progress/)).toBeVisible();
  expect(await screen.findByText("There is no playbook yet. Save the document and an agent will write one from it.")).toBeVisible();
  expect(screen.queryByText(/compile/i)).toBeNull();
});

test("the source the routing read carries is shown without reading the sources API", async () => {
  let reads = 0;
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(routingPath, () => HttpResponse.json({ enabled: true, source: source({ active: active(), latest: latest("saved") }) })),
    http.get(sourcePath, () => { reads++; return HttpResponse.json(bare); }));
  open();
  expect(await screen.findByRole("region", { name: "What the playbook does" })).toBeVisible();
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).toBeChecked();
  expect(reads).toBe(0);
});

test("a routing source that does not exist yet is said in a plain sentence, and the switch stays off", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json({ error: "not_found", message: "There is no playbook source routing" }, { status: 404 }))); open();
  expect(await screen.findByText("This server has not set up the routing playbook yet, so there is nothing to show.")).toBeVisible();
  expect(screen.queryByText(/could not be loaded|There is no playbook source|404/)).toBeNull();
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Author again" })).toBeNull();
  expect(screen.getByLabelText("Markdown")).toBeEnabled();
});

test("playbooks that are not running are said in a plain sentence, without the server's failure text", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json({ error: "playbooks_unavailable", message: "playbooks unavailable: error connecting to engine database: timeout" }, { status: 503 }))); open();
  expect(await screen.findByText("Playbooks are not running on this server right now. The routing playbook will show here once they are.")).toBeVisible();
  expect(screen.queryByText(/could not be loaded|engine database|playbooks unavailable|503/)).toBeNull();
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).toBeDisabled();
});

test("author again starts a run, which is polled until it ends; with nothing changed it says no run was started", async () => {
  let running = false, started = 0, reads = 0;
  const view = () => source({ active: active(), latest: running ? latest("running", { run: "8" }) : latest("saved") });
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => { reads++; const now = view(); if (running && reads > 4) running = false; return HttpResponse.json(now); }),
    http.post(`${sourcePath}/runs`, () => { started++; return HttpResponse.json(view()); }));
  open(20);
  await userEvent.click(await screen.findByRole("button", { name: "Author again" }));
  expect(await screen.findByText("Nothing has changed since this playbook was written, so no new run was started.")).toBeVisible();
  running = true; reads = 0;
  await userEvent.click(screen.getByRole("button", { name: "Author again" }));
  expect(await screen.findByText("Writing the playbook…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Author again" })).toBeNull();
  await waitFor(() => expect(screen.queryByText("Writing the playbook…")).toBeNull());
  expect(started).toBe(2);
  expect(screen.getByRole("button", { name: "Author again" })).toBeEnabled();
});

test("author again when playbooks are not running says so in a plain sentence", async () => {
  useSource(() => source({ latest: latest("failed", { refusal: "The agent ran out of time before it finished." }) }));
  server.use(http.post(`${sourcePath}/runs`, () => HttpResponse.json({ error: "playbooks_unavailable", message: "playbooks unavailable: engine database timeout" }, { status: 503 })));
  open();
  expect(await screen.findByText("The agent ran out of time before it finished.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Author again" }));
  expect(await screen.findByText(/Playbooks are not running on this server right now\./)).toBeVisible();
  expect(screen.queryByText(/engine database/)).toBeNull();
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
  const question = { question: "Which sentence wins?", sentences: [{ line: 3, text: "Research is Standard." }, { line: 9, end_line: 10, text: "Research is always Complex,\nwhatever else is said." }] };
  useSource(() => source({ active: active(), latest: latest("question", { question }) }));
  open();
  const asking = await screen.findByRole("region", { name: "The playbook needs an answer" });
  expect(asking).toHaveTextContent("Which sentence wins?");
  const items = within(asking).getAllByRole("listitem");
  expect(items[0]).toHaveTextContent("Line 3Research is Standard.");
  expect(items[1]).toHaveTextContent("Lines 9–10Research is always Complex, whatever else is said.");
  const editor = screen.getByLabelText("Markdown");
  expect(asking.parentElement).toBe(editor.closest("div")!.parentElement);
  expect(screen.getAllByText("The playbook needs an answer")).toHaveLength(1);
  fireEvent.change(editor, { target: { value: "# Fixed" } });
  expect(editor).toHaveValue("# Fixed");
  expect(screen.getByText("The previous playbook is still in effect.")).toBeVisible();
});

test("a sentence that cannot be carried out, and a refusal, are shown in plain words", async () => {
  useSource(() => source({ latest: latest("unable", { unable: { reason: "There is no plotter.", line: 12, sentence: "Art goes to the plotter." } }) }));
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
  server.use(http.get(path, () => HttpResponse.json({ ...snapshot(), revision: saved ? "2" : "1" })), http.put(path, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; saves.push(body); saved = true;
    return HttpResponse.json(receipt("2"));
  }), http.get(sourcePath, () => HttpResponse.json(source({ latest: latest("running", { run: saved ? "9" : "8", created_at_ms: saved ? Date.now() : Date.now() - 3_600_000, elapsed_ms: saved ? 0 : 3_600_000 }) }))));
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

const noPrevious = { comparison: null, can_rollback: false, previous: null };
test("rollback asks first, then the view the server sends back is used, and the source is still read again", async () => {
  let reads = 0, rolledBack = false;
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.get(sourcePath, () => { reads++; return HttpResponse.json(source({ active: active(rolledBack ? noPrevious : {}), latest: latest("saved") })); }),
    http.post(`${sourcePath}/rollback`, () => { rolledBack = true; return HttpResponse.json(source({ active: active(noPrevious), latest: latest("saved") })); }));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Roll back to the previous playbook" }));
  expect(rolledBack).toBe(false);
  const before = reads;
  await userEvent.click(screen.getByRole("button", { name: "Roll back" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Roll back/ })).toBeNull());
  await waitFor(() => expect(reads).toBeGreaterThan(before));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("There is no earlier playbook to compare it with.")).toBeVisible();
});

test("a refused rollback shows the server's words", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(sourcePath, () => HttpResponse.json(source({ active: active(), latest: latest("saved") }))),
    http.post(`${sourcePath}/rollback`, () => HttpResponse.json({ error: "conflict", message: "There is no earlier playbook to go back to." }, { status: 409 })));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Roll back to the previous playbook" }));
  await userEvent.click(screen.getByRole("button", { name: "Roll back" }));
  expect(await screen.findByText("There is no earlier playbook to go back to.")).toBeVisible();
});

test("a failed refresh while a run is in progress says so and stops polling", async () => {
  let reads = 0;
  useSource(() => { reads++; return source({ latest: latest("running") }); });
  open(20);
  await screen.findByText("Writing the playbook…");
  server.use(http.get(sourcePath, () => { reads++; return HttpResponse.json({ error: "boom", message: "x" }, { status: 500 }); }));
  expect(await screen.findByText(/could not be refreshed/)).toBeVisible();
  const settled = reads;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(reads).toBe(settled);
});

test("a very large report still shows the document, the playbook and the switch", async () => {
  const many = Array.from({ length: 5000 }, (_, i) => kase(`Situation ${i}`, "class: simple"));
  useSource(() => source({ active: active({ cases: many }), latest: latest("refused", { refusal: "e".repeat(300_000) }) }));
  open();
  expect(await screen.findByRole("region", { name: "What the playbook does" })).toBeVisible();
  expect(screen.getByRole("switch", { name: "Route tasks with this playbook" })).toBeEnabled();
  expect(screen.getByLabelText("Markdown")).toBeVisible();
});
