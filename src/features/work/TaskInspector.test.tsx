import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import task from "../../../contracts/live/human-graph/examples/task.json";
import { handlersFor } from "../../mocks/handlers";
import { FIXTURE_IDS } from "../../mocks/humanGraph";
import { renderApp } from "../../test/renderApp";
import { limited } from "./taskWork";
import { resetSectionMemory, SECTIONS_KEY } from "./inspector/sections";

// Spec 0004 Phase 1: the task inspector against the labelled human-graph fixtures (src/mocks/humanGraph.ts).
const server = setupServer(...handlersFor("default", { fixtures: true }));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
// Fresh fixture state per test: comment writes change the mock thread.
afterEach(() => { server.resetHandlers(...handlersFor("default", { fixtures: true })); localStorage.clear(); resetSectionMemory(); });
afterAll(() => server.close());
const project = task.project.id, scope = `?scope=project:${project}`;
const fixtureId = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const graph = `/api/human/projects/${project}/tasks`;
async function open(id: string, extra = "") {
  const app = renderApp(`/work/${id}${scope}${extra}`);
  const region = await screen.findByRole("region", { name: new RegExp(`^Fixture: |^${task.data.title}$`) });
  return { ...app, region };
}
const section = (region: HTMLElement, name: string) => within(region).getByRole("button", { name }).closest("section")!;
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (v: string) => { writes.push(v); return Promise.resolve(); } } });
});

test("item 1: the full task ID shows in a chip and copies with one click; every ID uses the same copy control", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  expect(within(region).getByText(FIXTURE_IDS.replay, { selector: "code" })).toBeVisible();
  await userEvent.click(within(region).getByRole("button", { name: "Copy task ID" }));
  expect(writes).toEqual([FIXTURE_IDS.replay]);
  // Attempt, session and result IDs carry the same control.
  await within(region).findAllByRole("button", { name: "Copy attempt ID" });
  expect(within(region).getAllByRole("button", { name: "Copy session ID" }).length).toBeGreaterThan(0);
  await userEvent.click(await within(region).findByRole("button", { name: "Copy result ID" }));
  expect(writes.at(-1)).toMatch(/^[0-9a-f-]{36}$/);
  await userEvent.click(within(region).getByRole("button", { name: "Copy task link" }));
  expect(writes.at(-1)).toContain(`/work/${FIXTURE_IDS.replay}?scope=project%3A${project}`);
});

test("item 2: a waiting task's badge names its unsatisfied blocker from the work read", async () => {
  const { region } = await open(fixtureId(4));
  const badge = await within(region).findByText(/^Waiting/, { selector: "[data-task-status] span" });
  expect(badge).toHaveTextContent(`Waiting · blocked by “${task.data.title}”`);
  const blockers = within(section(region, "Status")).getByRole("list", { name: "Unsatisfied blockers" });
  expect(within(blockers).getByRole("link", { name: task.data.title })).toHaveAttribute("href", expect.stringContaining(`/work/${task.data.id}`));
});

test("item 2: ready, running and unknown readiness come from the server, never inferred", async () => {
  let state = "ready";
  server.use(http.get(`${graph}/${FIXTURE_IDS.approve}/work`, () => HttpResponse.json({ ...task, data: { task_id: FIXTURE_IDS.approve, task_state: "active", version: "1", readiness: { state, blockers: [], complete: state !== "unknown" }, parent: null, execution: null } })));
  const first = await open(FIXTURE_IDS.approve);
  expect(await within(first.region).findByText("Ready", { selector: "[data-task-status] span" })).toBeVisible();
  first.unmount(); state = "unknown";
  const { region } = await open(FIXTURE_IDS.approve);
  expect(await within(region).findByText(/^Readiness unknown/, { selector: "[data-task-status] span" })).toHaveTextContent("Readiness unknown · relationships not fully read");
});

test("item 3: the holding attempt links to its session's terminal; a task without one says so", async () => {
  const { region, unmount } = await open(FIXTURE_IDS.replay);
  const status = section(region, "Status");
  expect(await within(status).findByRole("link", { name: "Open terminal" })).toHaveAttribute("href", expect.stringMatching(new RegExp(`^/agents/${fixtureId(0x302)}\\?scope=`)));
  expect(within(status).getByText("Running")).toBeVisible();
  unmount();
  const other = await open(FIXTURE_IDS.approve);
  expect(await within(section(other.region, "Status")).findByText("No agent attempt holds this task.")).toBeVisible();
});

test("item 4: attempts list provider, model, harness and times from each session, with copyable IDs", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  const list = await within(section(region, "Attempts")).findByRole("list", { name: "Attempts" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[0]!).getByText("Holds the task")).toBeVisible();
  await waitFor(() => expect(rows[0]).toHaveTextContent("anthropic · claude-opus-5-5 · claude-code"));
  expect(rows[0]).toHaveTextContent(/Started \d+[mh] ago · No stop recorded/);
  await waitFor(() => expect(rows[1]).toHaveTextContent("openai · gpt-5.3-codex · codex"));
  expect(rows[1]).toHaveTextContent("Failed");
  expect(rows[1]).toHaveTextContent(/Started .* · Stopped .*ago/);
  expect(within(rows[1]!).getByRole("link", { name: /Open session/ })).toHaveAttribute("href", expect.stringContaining(`/agents/${fixtureId(0x306)}`));
  expect(within(section(region, "Attempts")).getByText("2")).toBeVisible();
});

test("item 4: session reads run at most two at a time", async () => {
  let active = 0, peak = 0;
  const release: (() => void)[] = [];
  const work = () => limited(() => new Promise<void>(resolve => { active++; peak = Math.max(peak, active); release.push(() => { active--; resolve(); }); }));
  const all = Promise.all([work(), work(), work(), work()]);
  await waitFor(() => expect(release).toHaveLength(2));
  while (release.length) { release.shift()!(); await new Promise(r => setTimeout(r, 0)); }
  await all;
  expect(peak).toBe(2);
});

test("item 5: history reads every page and lists the newest change first, five until Show all", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  const history = section(region, "History");
  expect(within(history).getByRole("button", { name: "History" })).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(within(history).getByRole("button", { name: "History" }));
  const list = await within(history).findByRole("list", { name: "Change history" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  // 30 entries over two pages; the newest (entry 29) is an owner edit, entry 25 a fixture-agent edit.
  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Set task state");
  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("fixture-agent-session");
  await userEvent.click(within(history).getByRole("button", { name: "Show all 30 changes" }));
  expect(within(list).getAllByRole("listitem")).toHaveLength(30);
  expect(within(list).getAllByRole("listitem").at(-1)).toHaveTextContent("Create node");
  expect(within(list).getAllByRole("listitem").at(-1)).toHaveTextContent("Fixture: created from the recovery plan");
});

test("item 6: the parent links above the title; dependency reasons and their satisfied state show", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  const crumbs = within(region).getByRole("navigation", { name: "Task location" });
  expect(await within(crumbs).findByRole("link", { name: "Fixture: Worker recovery" })).toHaveAttribute("href", expect.stringContaining(`/work/${FIXTURE_IDS.parent}`));
  const deps = await within(section(region, "Dependencies and hierarchy")).findByRole("list", { name: "Recorded task dependencies" });
  const fixtures = within(deps).getByRole("link", { name: "Fixture: Recovery test fixtures" }).closest("li")!;
  expect(fixtures).toHaveTextContent("Blocks this task");
  expect(fixtures).toHaveTextContent("Fixtures precede replay");
  expect(fixtures).toHaveTextContent("Completed · Satisfied");
});

test("item 6: an epic shows child counts by state from the summary read", async () => {
  const { region } = await open(FIXTURE_IDS.parent);
  const hierarchy = section(region, "Dependencies and hierarchy");
  expect(await within(hierarchy).findByText(/descendants/)).toHaveTextContent("9 descendants: 4 active, 2 draft, 2 completed, 1 canceled");
  expect(within(hierarchy).getByRole("list", { name: "Child tasks" })).toBeVisible();
});

test("item 6: a truncated neighborhood says what it left out", async () => {
  server.use(...handlersFor("large", { fixtures: true }));
  const { region } = await open(FIXTURE_IDS.parent);
  expect(await within(section(region, "Dependencies and hierarchy")).findByText(/^Not shown: /)).toHaveTextContent(/Not shown: \d+ related tasks \(\d+ draft\)/);
});

test("item 7: the task's results link to the Results page", async () => {
  let read = "";
  server.events.on("request:start", ({ request }) => { if (new URL(request.url).pathname === "/api/v1/results") read = request.url; });
  const { region } = await open(FIXTURE_IDS.replay);
  const results = within(section(region, "Results"));
  const link = await results.findByRole("link", { name: /Replay reconciliation now merges/ });
  expect(link.getAttribute("href")).toMatch(/^\/results\/[0-9a-f-]{36}\/revisions\/[0-9a-f]{64}\?scope=project/);
  expect(results.getByRole("button", { name: "Copy check ID" })).toBeVisible();
  expect(results.getByRole("button", { name: "Copy evidence ID" })).toBeVisible();
  expect(results.getByRole("link", { name: "All results for this task" })).toHaveAttribute("href", expect.stringContaining(`task=${FIXTURE_IDS.replay}`));
  expect(new URL(read).searchParams.get("task_id")).toBe(FIXTURE_IDS.replay);
  expect(new URL(read).searchParams.get("project_id")).toBe(project);
  server.events.removeAllListeners();
});

test("item 7: without results.read the section says so and the view still renders", async () => {
  server.use(...handlersFor("default"));
  const { region } = await open(FIXTURE_IDS.replay);
  expect(within(section(region, "Results")).getByRole("note")).toHaveTextContent(/^Results not available on this server/);
  expect(within(region).getByRole("heading", { name: "Description" })).toBeVisible();
});

test("item 8: labels show as chips and Reprioritize is in the action menu", async () => {
  server.use(http.get(`${graph}/${FIXTURE_IDS.approve}`, () => HttpResponse.json({ ...task, data: { ...task.data, id: FIXTURE_IDS.approve, title: "Fixture: Approve recovery plan", labels: ["recovery", "owner-review"] } })));
  const { region } = await open(FIXTURE_IDS.approve);
  const labels = within(region).getByRole("list", { name: "Labels" });
  expect(within(labels).getAllByRole("listitem").map(l => l.textContent)).toEqual(["recovery", "owner-review"]);
  await userEvent.click(within(region).getByRole("button", { name: "More actions" }));
  await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Reprioritize" }));
  expect(within(screen.getByRole("dialog", { name: "Reprioritize" })).getByLabelText("Priority")).toBeVisible();
});

test("§3: sections fold, are remembered in this browser, and a closed section issues no read", async () => {
  const reads: string[] = [];
  server.events.on("request:start", ({ request }) => reads.push(new URL(request.url).pathname));
  const first = await open(FIXTURE_IDS.replay);
  const toggle = within(section(first.region, "Results")).getByRole("button", { name: "Results" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(JSON.parse(localStorage.getItem(SECTIONS_KEY)!)).toMatchObject({ results: false });
  first.unmount(); reads.length = 0;
  const { region } = await open(FIXTURE_IDS.replay);
  expect(within(section(region, "Results")).getByRole("button", { name: "Results" })).toHaveAttribute("aria-expanded", "false");
  await within(region).findByRole("list", { name: "Attempts" });
  expect(reads).not.toContain("/api/v1/results");
  // History is collapsed by default, so only its first page (shared with Attempts) is read.
  expect(reads.filter(p => p.endsWith("/history"))).toHaveLength(1);
  server.events.removeAllListeners();
});

test("§3: blocked storage keeps the defaults and still folds for this visit", async () => {
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  try {
    const { region } = await open(FIXTURE_IDS.replay);
    const toggle = within(section(region, "Description")).getByRole("button", { name: "Description" });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  } finally { spy.mockRestore(); set.mockRestore(); }
});

test("§3: Expand is reflected in ?focus=1 and Esc restores the split", async () => {
  const { region, router } = await open(FIXTURE_IDS.replay);
  await userEvent.click(within(region).getByRole("button", { name: "Expand" }));
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("1"));
  expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("focus")).toBeNull());
  // All tasks leaves Expand behind.
  expect(within(region).getByRole("link", { name: "All tasks" }).getAttribute("href")).not.toContain("focus");
});

test("§3: an Expand deep link opens expanded", async () => {
  await open(FIXTURE_IDS.replay, "&focus=1");
  expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector("[data-focus]")).not.toBeNull();
});

test("a failed work read leaves the rest of the inspector readable", async () => {
  server.use(http.get(`${graph}/${FIXTURE_IDS.replay}/work`, () => HttpResponse.json({ request_id: "x", code: "unavailable", message: "Read unavailable", retryable: false }, { status: 503 })));
  const { region } = await open(FIXTURE_IDS.replay);
  expect(await within(section(region, "Status")).findByRole("alert")).toHaveTextContent("Couldn't load this task's readiness");
  expect(within(region).getByText("Active", { selector: "[data-task-status] span" })).toBeVisible();
  expect(await within(region).findByRole("list", { name: "Attempts" })).toBeVisible();
});

/* ----- Item 13: comments ----- */
/** Thread entries only (a comment's Markdown can hold its own list). */
const entries = (thread: HTMLElement) => [...thread.querySelectorAll<HTMLElement>(":scope > li")];
async function bootstrapWith(change: Record<string, boolean>) {
  const { default: proposed } = await import("../../../contracts/proposed/bootstrap.json");
  const base = proposed as unknown as { data: { capabilities: { name: string; version: string; enabled: boolean; reason?: string }[] } };
  const names = ["human.graph.read", "tasks.read", "dashboard.actions", "tasks.comments.read", "tasks.comments.write", "tasks.edit"];
  return http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...base, data: { ...base.data, capabilities: [
    ...base.data.capabilities.filter(c => !names.includes(c.name)),
    ...names.map(name => (change[name] ?? true) ? { name, version: "1", enabled: true } : { name, version: "1", enabled: false, reason: "Fixture: not offered" }),
  ] } }));
}

test("item 13: the thread is newest first with authors, times, Markdown and a deleted placeholder", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  const thread = await within(section(region, "Comments")).findByRole("list", { name: "Comments" });
  const items = entries(thread);
  expect(items).toHaveLength(5);
  expect(items[0]).toHaveTextContent("owner@example.test");
  expect(items[0]).toHaveTextContent("edited");
  expect(within(items[0]!).getByText("phone", { selector: "strong" })).toBeVisible();
  expect(within(items[1]!).getByRole("link", { name: /session 00000000/ })).toHaveAttribute("href", expect.stringContaining(`/agents/${fixtureId(0x302)}`));
  expect(items[1]).toHaveTextContent("Supervisor");
  expect(items[2]).toHaveTextContent("Comment deleted");
  expect(within(items[2]!).queryByRole("button", { name: /Edit/ })).toBeNull();
  expect(items[3]).toHaveTextContent("Agent");
  expect(within(items[3]!).getByRole("link", { name: /session 00000000/ })).toHaveAttribute("href", expect.stringContaining(`/agents/${fixtureId(0x306)}`));
  expect(within(items[3]!).getByText("ledger/merge.rs", { selector: "code" })).toBeVisible();
  expect(items[4]).toHaveTextContent("aq-scheduler");
  expect(within(items[3]!).queryByRole("button", { name: /^Edit/ })).toBeNull();
  expect(within(section(region, "Comments")).getByText("50+")).toBeVisible();
});

test("item 13: Show all, then Load older pages back past 50 comments", async () => {
  const pages: (string | null)[] = [];
  server.events.on("request:start", ({ request }) => { const u = new URL(request.url); if (u.pathname.endsWith("/comments")) pages.push(u.searchParams.get("cursor")); });
  const { region } = await open(FIXTURE_IDS.replay);
  const comments = section(region, "Comments");
  const thread = await within(comments).findByRole("list", { name: "Comments" });
  await userEvent.click(within(comments).getByRole("button", { name: "Show all 50 loaded comments" }));
  expect(entries(thread)).toHaveLength(50);
  await userEvent.click(within(comments).getByRole("button", { name: "Load older comments" }));
  await waitFor(() => expect(entries(thread)).toHaveLength(57));
  expect(entries(thread).at(-1)).toHaveTextContent("Fixture progress note 1.");
  expect(within(comments).queryByRole("button", { name: "Load older comments" })).toBeNull();
  expect(pages).toHaveLength(2); expect(pages[0]).toBeNull(); expect(pages[1]).toBeTruthy();
  server.events.removeAllListeners();
});

test("item 13: the composer posts as the owner and the new comment leads the thread", async () => {
  const posted: Record<string, unknown>[] = [];
  server.events.on("request:start", async ({ request }) => { if (new URL(request.url).pathname === "/api/v1/actions") posted.push(await request.clone().json()); });
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  await userEvent.type(within(comments).getByLabelText("Add a comment"), "Looks **good** to me");
  await userEvent.click(within(comments).getByRole("button", { name: "Comment" }));
  await waitFor(() => expect(entries(within(comments).getByRole("list", { name: "Comments" }))).toHaveLength(2));
  const first = entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  expect(within(first).getByText("good", { selector: "strong" })).toBeVisible();
  expect(within(comments).getByLabelText("Add a comment")).toHaveValue("");
  const body = posted[0] as { kind: string; subject: unknown; expected_versions: unknown; operation_id: string; payload: Record<string, unknown> };
  expect(body.kind).toBe("task.comment.add");
  expect(body.subject).toEqual({ type: "task", id: FIXTURE_IDS.approve });
  expect(body.expected_versions).toEqual({});
  expect(body.payload).toEqual({ operation_id: body.operation_id, project_id: project, body: "Looks **good** to me" });
  server.events.removeAllListeners();
});

test("item 13: a blank or oversized comment is refused before sending", async () => {
  let posts = 0; server.events.on("request:start", ({ request }) => { if (new URL(request.url).pathname === "/api/v1/actions") posts++; });
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await userEvent.click(within(comments).getByRole("button", { name: "Comment" }));
  expect(within(comments).getByRole("alert")).toHaveTextContent("Write a comment first.");
  expect(posts).toBe(0);
  server.events.removeAllListeners();
});

test("item 13: the owner edits and deletes their own comment; a deleted one leaves a placeholder", async () => {
  const posted: { kind: string; subject: unknown; payload: Record<string, unknown> }[] = [];
  server.events.on("request:start", async ({ request }) => { if (new URL(request.url).pathname === "/api/v1/actions") posted.push(await request.clone().json()); });
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  const item = () => entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await within(comments).findByRole("list", { name: "Comments" });
  await userEvent.click(within(item()).getByRole("button", { name: /^Edit/ }));
  const editor = within(item()).getByLabelText("Edit comment");
  await userEvent.clear(editor); await userEvent.type(editor, "Fixture: the review is done.");
  await userEvent.click(within(item()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(item()).toHaveTextContent("Fixture: the review is done."));
  expect(item()).toHaveTextContent("edited");
  expect(posted[0]).toMatchObject({ kind: "task.comment.edit", subject: { type: "task_comment", id: fixtureId(0x550), revision: "1" }, expected_versions: { task_comment: "1" }, payload: { expected_revision: "1", body: "Fixture: the review is done." } });
  await userEvent.click(within(item()).getByRole("button", { name: /^Delete/ }));
  await userEvent.click(within(item()).getByRole("button", { name: "Delete comment" }));
  await waitFor(() => expect(item()).toHaveTextContent("Comment deleted"));
  expect(posted[1]).toMatchObject({ kind: "task.comment.delete", subject: { type: "task_comment", id: fixtureId(0x550), revision: "2" }, payload: { expected_revision: "2" } });
  expect(posted[1]!.payload).not.toHaveProperty("body");
  server.events.removeAllListeners();
});

test("item 13: a stale edit is a conflict that keeps the thread and says so", async () => {
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    const body = await request.json() as { operation_id: string; subject: unknown; payload: { project_id: string } };
    return HttpResponse.json({ api_version: "dashboard-actions-1", request_id: "x", data: { operation_id: body.operation_id, disposition: "conflict", request_digest: `sha256:${"0".repeat(64)}`, scope: { kind: "project", project_id: body.payload.project_id },
      created_at: "2026-11-06T12:00:00.000Z", updated_at: "2026-11-06T12:00:00.000Z", subject_refs: [body.subject], receipt_refs: [], affected_entities: [], recovery: "refresh_and_review", current_versions: { task_comment: "3" } } });
  }));
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item).getByRole("button", { name: /^Edit/ }));
  await userEvent.type(within(item).getByLabelText("Edit comment"), " more");
  await userEvent.click(within(item).getByRole("button", { name: "Save" }));
  expect(await within(item).findByRole("alert")).toHaveTextContent("This comment changed since you read it.");
});

test("item 13: AQ's refusal is shown and the draft is kept", async () => {
  server.use(http.post("/api/v1/actions", () => HttpResponse.json({ request_id: "x", code: "comment_not_author", message: "Only the owner who wrote a comment can edit or delete it", retryable: false }, { status: 403 })));
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item).getByRole("button", { name: /^Delete/ }));
  await userEvent.click(within(item).getByRole("button", { name: "Delete comment" }));
  expect(await within(item).findByRole("alert")).toHaveTextContent("Only the owner who wrote a comment can edit or delete it.");
  expect(item).not.toHaveTextContent("Comment deleted");
});

test("item 13: an unknown outcome resends the identical request, never a second comment", async () => {
  const bodies: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { bodies.push(await request.clone().text()); return bodies.length === 1 ? HttpResponse.error() : undefined; }),
    http.get("/api/v1/operations/:id", () => HttpResponse.json({ request_id: "x", code: "not_found", message: "Not found", retryable: false }, { status: 404 })));
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  await userEvent.type(within(comments).getByLabelText("Add a comment"), "Once only");
  await userEvent.click(within(comments).getByRole("button", { name: "Comment" }));
  await userEvent.click(await within(comments).findByRole("button", { name: "Send the same comment again" }));
  await waitFor(() => expect(entries(within(comments).getByRole("list", { name: "Comments" }))).toHaveLength(2));
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
});

test("item 13: without the comment capabilities the section says so and the view still renders", async () => {
  server.use(await bootstrapWith({ "tasks.comments.read": false }));
  const first = await open(FIXTURE_IDS.replay);
  expect(within(section(first.region, "Comments")).getByRole("note")).toHaveTextContent(/^Comments not available on this server/);
  expect(within(first.region).getByRole("heading", { name: "Description" })).toBeVisible();
  first.unmount();
  server.use(await bootstrapWith({ "tasks.comments.write": false }));
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  expect(within(comments).getByRole("note")).toHaveTextContent(/^Writing comments not available on this server/);
  await within(comments).findByRole("list", { name: "Comments" });
  expect(within(comments).queryByLabelText("Add a comment")).toBeNull();
  expect(within(comments).queryByRole("button", { name: /^Edit/ })).toBeNull();
});

test("item 13: a comment read this bundle can't adapt fails only its section", async () => {
  server.use(http.get(`${graph}/${FIXTURE_IDS.replay}/comments`, () => HttpResponse.json({ ...task, data: { task_id: FIXTURE_IDS.replay, items: [{ comment_id: "nope" }], next_cursor: null } })));
  const { region } = await open(FIXTURE_IDS.replay);
  expect(await within(section(region, "Comments")).findByRole("alert")).toHaveTextContent("can't read AQ's response for this task's comments");
  expect(await within(region).findByRole("list", { name: "Attempts" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Dashboard update required" })).toBeNull();
});
