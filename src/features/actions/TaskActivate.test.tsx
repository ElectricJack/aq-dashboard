import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import confirmed from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { graphEnvelope, graphNode, graphProject } from "../../test/humanGraph";

/** `task.activate` (dashboard-actions-1): a draft task becomes Active, bound to its current Graph version. */
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());

type Body = { operation_id: string; kind: string; subject: unknown; expected_versions: unknown; payload: Record<string, unknown> };
const CAPABILITIES = ["human.graph.read", "tasks.read", "dashboard.actions", "tasks.edit", "tasks.cancel", "tasks.activate"];
function operation(id: string, disposition: string, extra: Record<string, unknown> = {}) {
  return { ...confirmed, data: { ...confirmed.data, operation_id: id, disposition, subject_refs: [],
    receipt_refs: disposition === "confirmed" ? [{ type: "graph_change_set", id: "00000000-0000-4000-8000-000000000099" }] : [],
    affected_entities: disposition === "confirmed" ? [{ type: "task", id: graphNode("task").id, revision: "9007199254740994" }] : [],
    recovery: disposition === "confirmed" ? "none" : "refresh_and_review", ...extra } };
}
/** A draft task whose served state and version the test (or a confirmed activation) can change. */
function draft({ activate = true }: { activate?: boolean } = {}) {
  const node = graphNode("task"), live = { task_state: "draft" as string, version: node.version }, reads = { detail: 0, list: 0 };
  const base = `/api/human/projects/${graphProject}/tasks`;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
      ...bootstrap.data.capabilities.filter(c => !CAPABILITIES.includes(c.name)),
      ...CAPABILITIES.filter(name => activate || name !== "tasks.activate").map(name => ({ name, version: "1", enabled: true })),
    ] } })),
    http.get(base, () => { reads.list++; return HttpResponse.json(graphEnvelope({ items: [{ ...node, ...live }], next_cursor: null })); }),
    http.get(`${base}/${node.id}`, () => { reads.detail++; return HttpResponse.json(graphEnvelope({ ...node, ...live })); }),
    http.get(`${base}/${node.id}/work`, () => HttpResponse.json(graphEnvelope({ task_id: node.id, task_state: live.task_state, version: live.version,
      readiness: { state: live.task_state === "draft" ? "draft" : "ready", blockers: [], complete: true }, parent: null, execution: null }))),
  );
  return { node, live, reads };
}
async function openActivate() {
  const button = await screen.findByRole("button", { name: "Activate task" });
  // Keyboard only: focus the primary action and press Enter.
  button.focus(); await userEvent.keyboard("{Enter}");
  return screen.getByRole("dialog", { name: "Activate task" });
}

test("a draft task's primary action activates it with the current version, once, and refreshes the task views", async () => {
  const { node, live, reads } = draft(), posts: Body[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    expect(request.headers.get("X-AQ-Request")).toBe("1");
    const body = await request.json() as Body; posts.push(body); await gate;
    live.task_state = "active"; live.version = "9007199254740994";
    return HttpResponse.json(operation(body.operation_id, "confirmed"));
  }));
  renderApp(`/work/${node.id}?scope=project:${graphProject}`);
  const dialog = await openActivate();
  expect(within(dialog).getByText(/AQ can schedule this task once its dependencies are complete/)).toBeVisible();
  expect(within(dialog).getByText(/human review gates still apply/)).toBeVisible();
  const submit = within(dialog).getByRole("button", { name: "Activate" });
  const before = { ...reads };
  submit.focus(); await userEvent.keyboard("{Enter}{Enter}");
  await userEvent.dblClick(submit).catch(() => undefined);
  await waitFor(() => expect(posts).toHaveLength(1));
  // While pending the dialog shows no success and offers no second submission.
  expect(within(dialog).queryByText(/Task activated/)).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Activate" })).toBeNull();
  release();
  expect(await within(dialog).findByText("Task activated.")).toBeVisible();
  expect(posts).toHaveLength(1);
  const body = posts[0]!;
  expect(body).toMatchObject({ kind: "task.activate", subject: { type: "task", id: node.id, revision: node.version }, expected_versions: { task: node.version } });
  expect(body.payload).toEqual({ operation_id: body.operation_id, project_id: graphProject, expected_version: node.version });
  await waitFor(() => { expect(reads.detail).toBeGreaterThan(before.detail); expect(reads.list).toBeGreaterThan(before.list); });
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  // The refreshed task is Active: activation is no longer offered.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Activate task" })).toBeNull());
  expect(screen.getAllByText("Active", { exact: true }).length).toBeGreaterThan(0);
});

test("a stale revision is a conflict: nothing is claimed, and a reload resubmits against the current version", async () => {
  const { node, live } = draft(), posts: Body[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    const body = await request.json() as Body; posts.push(body);
    if (posts.length === 1) { live.version = "9007199254740995"; return HttpResponse.json(operation(body.operation_id, "conflict", { current_versions: { task: live.version } })); }
    return HttpResponse.json(operation(body.operation_id, "confirmed"));
  }));
  renderApp(`/work/${node.id}?scope=project:${graphProject}`);
  const dialog = await openActivate();
  await userEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
  expect(await within(dialog).findByText(/Conflict — the task changed since you opened it\. Nothing was activated\./)).toBeVisible();
  expect(within(dialog).getByText("Current versions: task: 9007199254740995")).toBeVisible();
  expect(within(dialog).queryByText(/Task activated/)).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Reload current versions" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Activate" }));
  await within(dialog).findByText(/^Task activated\./);
  expect(posts).toHaveLength(2); expect(posts[1]!.operation_id).not.toBe(posts[0]!.operation_id);
  expect(posts[1]!.expected_versions).toEqual({ task: "9007199254740995" });
  expect(posts[1]!.payload.expected_version).toBe("9007199254740995");
});

test("a task that stopped being a draft is not resubmitted after reload", async () => {
  const { node, live } = draft(); let posts = 0;
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    posts++; live.task_state = "canceled"; live.version = "9007199254740995";
    return HttpResponse.json(operation((await request.json() as Body).operation_id, "rejected"));
  }));
  renderApp(`/work/${node.id}?scope=project:${graphProject}`);
  const dialog = await openActivate();
  await userEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
  expect(await within(dialog).findByRole("status")).toHaveTextContent("Rejected — AQ refused this action. It activates only a draft task. Reload current versions to see the task's state.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Reload current versions" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Activate" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("This task is canceled now; AQ activates only a draft task. Nothing was submitted.");
  expect(posts).toBe(1);
});

test("a denied activation keeps the task a draft and says nothing changed", async () => {
  const { node } = draft(); const ids: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    ids.push((await request.json() as Body).operation_id);
    return HttpResponse.json({ request_id: "r", code: "forbidden", message: "This request is not available to your account", retryable: false }, { status: 403 });
  }));
  renderApp(`/work/${node.id}?scope=project:${graphProject}`);
  const dialog = await openActivate();
  await userEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("AQ refused this action. This request is not available to your account. Nothing was changed.");
  expect(within(dialog).queryByText(/Task activated/)).toBeNull();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(ids).toHaveLength(1);
});

test("a failed request reports an unknown outcome, never success", async () => {
  const { node } = draft();
  server.use(http.post("/api/v1/actions", () => HttpResponse.error()),
    http.get("/api/v1/operations/:id", () => HttpResponse.json({ request_id: "lookup", code: "not_found", message: "Not available", retryable: false }, { status: 404 })));
  renderApp(`/work/${node.id}?scope=project:${graphProject}`);
  const dialog = await openActivate();
  await userEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
  expect(await within(dialog).findByText(/Outcome unknown/)).toBeVisible();
  expect(within(dialog).queryByText(/Task activated/)).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Retry exact submission" })).toBeEnabled();
});

test("activation is offered only for drafts, and only when AQ advertises it", async () => {
  const first = draft({ activate: false });
  const view = renderApp(`/work/${first.node.id}?scope=project:${graphProject}`);
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
  expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: /^Activate task/ })).toHaveAccessibleDescription("Not offered");
  view.unmount(); server.resetHandlers();
  const active = draft(); active.live.task_state = "active";
  renderApp(`/work/${active.node.id}?scope=project:${graphProject}`);
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
  expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: /Activate task/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Activate task" })).toBeNull();
});
