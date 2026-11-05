import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import confirmed from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { handlersFor } from "../../mocks/handlers";
import { playbookPage, runDetail, runRecord } from "../../test/playbooks";
import { renderApp } from "../../test/renderApp";
import { activationCatalog, catalogActivation, catalogDefinition, definitionCatalog } from "../../test/playbookCatalog";

const ACTION_CAPS = ["dashboard.actions", "playbooks.runs.start", "playbooks.runs.cancel", "playbooks.activations.activate", "playbooks.activations.rollback"];
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());

/** Read capabilities on; `actions` names the action capabilities offered (others stay absent). */
function caps(actions: string[] = ACTION_CAPS, disabled: Record<string, string> = {}) {
  const names = ["playbooks.inspect", "playbooks.catalog.read", ...ACTION_CAPS];
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !names.includes(c.name)),
    ...["playbooks.inspect", "playbooks.catalog.read", ...actions].map(name => ({ name, version: "1", enabled: !disabled[name], ...(disabled[name] ? { reason: disabled[name] } : {}) })),
  ] } })));
}
function runs(status = "waiting") {
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([runRecord("run-0000000000000001", status)]))),
    http.get("/api/playbooks/inspection/runs/:id", ({ params }) => { const d = runDetail(String(params.id)); return HttpResponse.json({ ...d, run: { ...d.run, status } }); }));
}
function operation(id: string, disposition = "confirmed", subject = { type: "playbook_run", id: "run-0000000000000001" }) {
  return { ...confirmed, data: { ...confirmed.data, operation_id: id, disposition, subject_refs: [subject],
    receipt_refs: disposition === "confirmed" ? [{ type: "playbook_operation", id }] : [], affected_entities: [] } };
}
async function openCancel() {
  renderApp("/playbooks/runs/run-0000000000000001");
  const detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  await userEvent.click(within(detail).getByRole("button", { name: "Cancel run" }));
  return { detail, dialog: await screen.findByRole("dialog", { name: "Cancel run" }) };
}

test("playbook_cancel_shows_pending_safe_state", async () => {
  caps(); runs(); const posts: string[] = []; let id = "", lookups = 0, settle = "pending";
  server.use(http.post("/api/v1/actions", async ({ request }) => { const text = await request.text(); posts.push(text); id = JSON.parse(text).operation_id; return HttpResponse.json(operation(id, "pending"), { status: 202 }); }),
    http.get("/api/v1/operations/:id", ({ params }) => { lookups++; expect(params.id).toBe(id); return HttpResponse.json(operation(id, settle)); }));
  const { detail, dialog } = await openCancel();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Confirm this action before submitting."); expect(posts).toHaveLength(0);
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Superseded by run-2");
  await userEvent.click(within(dialog).getByRole("checkbox", { name: /Confirm cancellation request/ }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Cancellation requested — awaiting confirmation.")).toBeInTheDocument();
  await waitFor(() => expect(lookups).toBeGreaterThan(0));
  const body = JSON.parse(posts[0]!);
  expect(body).toMatchObject({ kind: "playbook.run.cancel", subject: { type: "playbook_run", id: "run-0000000000000001" }, reason: "Superseded by run-2", payload: { run_id: "run-0000000000000001", project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
  // The dashboard never relabels the run: its badge stays the server's state while the intent is pending.
  expect(within(detail).getAllByText("Waiting").length).toBeGreaterThan(0); expect(within(detail).queryByText("Cancelled")).toBeNull();
  expect(within(detail).getByRole("button", { name: "Cancel run · operation" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Submit" })).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Retry exact submission" }));
  await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1]).toBe(posts[0]);
  settle = "confirmed"; await userEvent.click(within(dialog).getByRole("button", { name: "Check status" }));
  expect(await within(dialog).findByText("Cancellation requested", { exact: true })).toBeInTheDocument();
  expect(within(dialog).getByText(/does not prove the run stopped/)).toBeInTheDocument();
});

test("cancel is unavailable with the server's reason when the union kind is not offered", async () => {
  caps([]); runs(); renderApp("/playbooks/runs/run-0000000000000001");
  const detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  expect(within(detail).getByRole("button", { name: "Cancel run" })).toBeDisabled();
  expect(within(detail).getByText("Not offered by this AQ server")).toBeInTheDocument();
});

test("cancel is unavailable for a finished run and when the action union is disabled", async () => {
  caps(ACTION_CAPS, { "dashboard.actions": "Dashboard actions are paused" }); runs(); const { unmount } = renderApp("/playbooks/runs/run-0000000000000001");
  let detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  expect(within(detail).getByText("Dashboard actions are paused")).toBeInTheDocument(); unmount();
  server.resetHandlers(); caps(); runs("completed"); renderApp("/playbooks/runs/run-0000000000000001");
  detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  expect(within(detail).getByRole("button", { name: "Cancel run" })).toBeDisabled(); expect(within(detail).getByText("This run has finished")).toBeInTheDocument();
});

const DEF_A = `sha256:${"a".repeat(64)}`, DEF_B = `sha256:${"b".repeat(64)}`, ACT = `sha256:${"c".repeat(64)}`;
function catalogs() {
  const b = catalogDefinition(DEF_B); b.record.metadata.name = "worker-recovery-v4";
  const pick = (all: { key: string }[], url: URL) => all.filter(i => !url.searchParams.get("exact") || i.key === url.searchParams.get("exact"));
  server.use(http.get("/api/playbooks/inspection/catalog/:kind", ({ params, request }) => { const url = new URL(request.url);
    return HttpResponse.json(params.kind === "activations" ? activationCatalog(pick([catalogActivation(ACT)], url) as never) : definitionCatalog(pick([catalogDefinition(DEF_A), b], url) as never)); }));
}
const BINDING = { type: "playbook_binding", id: "catalog-contract-binding" };

test("playbook_start_posts_typed_inputs", async () => {
  caps(); runs(); catalogs(); const posts: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { const text = await request.text(); posts.push(text); return HttpResponse.json(operation(JSON.parse(text).operation_id, "pending", BINDING), { status: 202 }); }),
    http.get("/api/v1/operations/:id", ({ params }) => HttpResponse.json(operation(String(params.id), "confirmed", BINDING))));
  renderApp("/playbooks");
  const roster = await screen.findByRole("region", { name: "Recent runs" });
  await waitFor(() => expect(within(roster).getByRole("button", { name: "Start run" })).toBeEnabled()); await userEvent.click(within(roster).getByRole("button", { name: "Start run" }));
  const dialog = await screen.findByRole("dialog", { name: "Start run" });
  expect(within(dialog).getByText("Starts a new run pinned to the binding's current definition.")).toBeInTheDocument();
  expect(within(dialog).getByRole("combobox", { name: "Entry" })).toHaveValue("main"); expect(dialog.querySelector("textarea")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Add input" })); await userEvent.click(within(dialog).getByRole("button", { name: "Add input" }));
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Input 1 name" }), "limit");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Input 1 type" }), "number");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Input 1 value" }), "abc");
  await userEvent.type(within(dialog).getByRole("textbox", { name: "Input 2 name" }), "dry_run");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Input 2 type" }), "boolean");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Input limit must be a number."); expect(posts).toHaveLength(0);
  await userEvent.clear(within(dialog).getByRole("textbox", { name: "Input 1 value" })); await userEvent.type(within(dialog).getByRole("textbox", { name: "Input 1 value" }), "3");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Run start confirmed")).toBeInTheDocument();
  expect(JSON.parse(posts[0]!)).toMatchObject({ kind: "playbook.run.start", subject: { ...BINDING, revision: "3" }, expected_versions: { playbook_binding: "3" },
    payload: { binding: "catalog-contract-binding", artifact: DEF_A, entry: "main", inputs: { limit: 3, dry_run: true }, expected_version: "3" } });
});

async function openActivation(name: "Activate definition" | "Roll back activation") {
  renderApp(`/playbooks?view=activations&activation=${ACT}`);
  const detail = await screen.findByRole("region", { name: "Activation catalog-contract-binding" });
  expect(within(detail).getByText(/is active for new runs · binding revision 3\./)).toBeInTheDocument();
  expect(within(detail).getAllByText(/Activation affects future runs only\. Existing runs keep their pinned definition\. Installing and compiling are separate operations\./).length).toBeGreaterThan(0);
  const button = within(detail).getByRole("button", { name }); await waitFor(() => expect(button).toBeEnabled()); await userEvent.click(button);
  return screen.findByRole("dialog", { name });
}

test("playbook_activate_conflict_preserves_selection", async () => {
  caps(); catalogs(); let reads = 0, posts = 0;
  server.use(http.post("/api/v1/actions", async ({ request }) => { posts++; expect(JSON.parse(await request.text())).toMatchObject({ kind: "playbook.activation.activate", payload: { binding: "catalog-contract-binding", artifact: DEF_B, expected_version: "3" } });
    return HttpResponse.json({ request_id: "r", code: "version_conflict", message: "Another owner changed this binding.", retryable: false, current_versions: { playbook_binding: "4" } }, { status: 409 }); }));
  server.events.on("request:start", ({ request }) => { if (request.url.includes("/catalog/activations")) reads++; });
  const dialog = await openActivation("Activate definition");
  const select = within(dialog).getByRole("combobox", { name: "Definition" }); expect(select).toHaveValue(DEF_B);
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Confirm activation for new runs." })); await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Conflict — your draft is preserved.")).toBeInTheDocument(); expect(within(dialog).getByText("Current versions: playbook_binding: 4")).toBeInTheDocument();
  const before = reads; await userEvent.click(within(dialog).getByRole("button", { name: "Reload current versions" }));
  await waitFor(() => expect(reads).toBeGreaterThan(before)); expect(await within(dialog).findByRole("button", { name: "Submit" })).toBeEnabled();
  expect(within(dialog).getByRole("combobox", { name: "Definition" })).toHaveValue(DEF_B); expect(posts).toBe(1);
  server.events.removeAllListeners();
});

test("playbook activate shows the rejected outcome", async () => {
  caps(); catalogs();
  server.use(http.post("/api/v1/actions", () => HttpResponse.json({ request_id: "r", code: "invalid_request", message: "Definition is not installed.", retryable: false }, { status: 422 })));
  const dialog = await openActivation("Activate definition");
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Confirm activation for new runs." })); await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Rejected — the server did not permit this action. Review the playbook and permissions.")).toBeInTheDocument();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Definition is not installed.");
});

test("playbook_rollback_requires_confirmation_and_confirms", async () => {
  caps(); catalogs(); const posts: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { const text = await request.text(); posts.push(text); return HttpResponse.json(operation(JSON.parse(text).operation_id, "confirmed", BINDING)); }));
  const dialog = await openActivation("Roll back activation");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Confirm this action before submitting."); expect(posts).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Confirm rollback for new runs." })); await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Rollback confirmed for new runs")).toBeInTheDocument();
  expect(JSON.parse(posts[0]!)).toMatchObject({ kind: "playbook.activation.rollback", subject: { ...BINDING, revision: "3" }, payload: { binding: "catalog-contract-binding", artifact: DEF_A } });
});
