import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import confirmed from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { graphEnvelope, graphId, graphNode, graphProject } from "../../test/humanGraph";
import type { GraphNode } from "../../api/adapters/humanGraph";

const KINDS = ["knowledge.author", "knowledge.correct", "knowledge.verify", "knowledge.retire", "knowledge.restore"];
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const scope = `?scope=project:${graphProject}`;
const base = `/api/human/projects/${graphProject}/knowledge`;

/** Knowledge reads and every knowledge action offered; `revisions` serves exact historical revisions. */
function setup(node: GraphNode, revisions: Record<string, Partial<GraphNode>> = {}) {
  const names = ["human.graph.read", "knowledge.read", "dashboard.actions", ...KINDS];
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data,
    capabilities: [...bootstrap.data.capabilities.filter(c => !names.includes(c.name)), ...names.map(name => ({ name, version: "1", enabled: true }))] } })),
  http.get(base, () => HttpResponse.json(graphEnvelope({ items: [node], next_cursor: null }))),
  http.get(`${base}/${node.id}`, ({ request }) => {
    const revision = new URL(request.url).searchParams.get("revision");
    if (!revision) return HttpResponse.json(graphEnvelope(node));
    const old = revisions[revision];
    return old ? HttpResponse.json(graphEnvelope({ ...node, ...old, content_revision: revision })) : HttpResponse.json({ code: "not_found", message: "Missing", request_id: "r", retryable: false }, { status: 404 });
  }));
}
function operation(id: string, disposition = "confirmed", affected = [{ type: "knowledge", id: graphId(10), revision: "5" }]) {
  return { ...confirmed, data: { ...confirmed.data, operation_id: id, disposition, subject_refs: [],
    receipt_refs: disposition === "confirmed" ? [{ type: "graph_change_set", id: graphId(99) }] : [], affected_entities: disposition === "confirmed" ? affected : [] } };
}
const retired = (): GraphNode => ({ ...graphNode("knowledge"), retired: true, retirement_reason: "Superseded", content_revision: "5", verification: "unverified" });

test("a retired record offers only Restore record (ISSUE-004, N-03)", async () => {
  setup(retired(), { "4": { retired: false } }); renderApp(`/knowledge/${graphId(10)}${scope}`);
  const restore = await screen.findByRole("button", { name: "Restore record" });
  expect(restore).toBeEnabled();
  for (const name of ["Correct record", "Verify record", "Retire record"]) expect(screen.queryByRole("button", { name })).toBeNull();
});

test("restore submits the previous active revision with its lifecycle (ISSUE-004)", async () => {
  const posts: Record<string, unknown>[] = [];
  setup(retired(), { "4": { retired: false, title: "Execution ownership model" } });
  server.use(http.post("/api/v1/actions", async ({ request }) => { const body = await request.json() as Record<string, unknown>; posts.push(body); return HttpResponse.json(operation(String(body.operation_id))); }));
  renderApp(`/knowledge/${graphId(10)}${scope}`);
  await userEvent.click(await screen.findByRole("button", { name: "Restore record" }));
  const dialog = screen.getByRole("dialog", { name: "Restore record" });
  expect(within(dialog).getByRole("textbox", { name: "Content revision to restore" })).toHaveValue("4");
  expect(await within(dialog).findByText("Revision 4: “Execution ownership model” · Active")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Confirm this action before submitting."); expect(posts).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole("checkbox", { name: /Confirm restore/ }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByText("Action confirmed")).toBeInTheDocument();
  expect(posts[0]).toMatchObject({ kind: "knowledge.restore", subject: { type: "knowledge", id: graphId(10), revision: "9007199254740993" },
    payload: { project_id: graphProject, expected_version: "9007199254740993", revision: 4, include_lifecycle: true } });
  expect(posts[0]).not.toHaveProperty("reason");
});

test("restore refuses a target revision that is itself retired or not earlier", async () => {
  const posts: unknown[] = [];
  setup(retired(), { "4": { retired: true }, "3": { retired: false } });
  server.use(http.post("/api/v1/actions", async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({}, { status: 500 }); }));
  renderApp(`/knowledge/${graphId(10)}${scope}`);
  await userEvent.click(await screen.findByRole("button", { name: "Restore record" }));
  const dialog = screen.getByRole("dialog", { name: "Restore record" });
  await within(dialog).findByText(/Revision 4: .* · Retired — choose an earlier revision/);
  await userEvent.click(within(dialog).getByRole("checkbox", { name: /Confirm restore/ }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Revision 4 is also retired. Choose an earlier active revision.");
  const field = within(dialog).getByRole("textbox", { name: "Content revision to restore" });
  await userEvent.clear(field); await userEvent.type(field, "5"); await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose a revision earlier than the current revision 5.");
  expect(posts).toHaveLength(0);
});

test("while an operation is unsettled the other actions say why they are disabled (ISSUE-010)", async () => {
  setup(graphNode("knowledge"));
  server.use(http.post("/api/v1/actions", async ({ request }) => { const body = await request.json() as { operation_id: string }; return HttpResponse.json(operation(body.operation_id, "pending"), { status: 202 }); }),
    http.get("/api/v1/operations/:id", ({ params }) => HttpResponse.json(operation(String(params.id), "pending"))));
  renderApp(`/knowledge/${graphId(10)}${scope}`);
  await userEvent.click(await screen.findByRole("button", { name: "Correct record" }));
  const dialog = screen.getByRole("dialog", { name: "Correct record" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await within(dialog).findByText("Action pending — awaiting confirmation.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  for (const name of ["Verify record", "Retire record"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled(); expect(button).toHaveAccessibleDescription("Settle the current operation first");
  }
  expect(screen.getByRole("button", { name: "Correct record · operation" })).toBeEnabled();
});

test("category choices use the same human labels as the library (ISSUE-012)", async () => {
  setup(graphNode("knowledge")); renderApp(`/knowledge/${graphId(10)}${scope}`);
  await userEvent.click(await screen.findByRole("button", { name: "Correct record" }));
  const category = within(screen.getByRole("dialog", { name: "Correct record" })).getByRole("combobox", { name: "Category" });
  expect(category).toHaveValue("decision");
  expect(within(category).getAllByRole("option").map(o => o.textContent)).toEqual(["Fact", "Decision", "Policy", "Procedure", "Incident", "Reference", "Note"]);
});

test("a confirmed Add record links to the new record (N-06)", async () => {
  let created = "";
  setup(graphNode("knowledge"));
  server.use(http.post("/api/v1/actions", async ({ request }) => { const body = await request.json() as { operation_id: string }; created = body.operation_id; return HttpResponse.json(operation(created, "confirmed", [{ type: "knowledge", id: created, revision: "1" }])); }));
  renderApp(`/knowledge${scope}`);
  const add = await waitFor(() => { const b = screen.getByRole("button", { name: "Add record" }); expect(b).not.toHaveAttribute("aria-disabled", "true"); return b; });
  await userEvent.click(add);
  const dialog = screen.getByRole("dialog", { name: "Add record" });
  await userEvent.type(within(dialog).getByLabelText("Title"), "A new runbook");
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  const link = await within(dialog).findByRole("link", { name: "Open new record" });
  expect(link).toHaveAttribute("href", `/knowledge/${created}?scope=project%3A${graphProject}`);
});
