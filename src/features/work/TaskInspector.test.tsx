import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import task from "../../../contracts/live/human-graph/examples/task.json";
import workExample from "../../../contracts/live/human-graph/examples/work.json";
import historyExample from "../../../contracts/live/human-graph/examples/history.json";
import resultsValid from "../../../contracts/pinned/results-feedback/v1/fixtures/valid.json";
import resultsCompat from "../../../contracts/pinned/results-feedback/v1/fixtures/compatibility.json";
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

/* ----- QA 2026-11-06 Phase 1 findings (qa/2026-11-06/parity-p1/issues.md) ----- */

const workRead = (id: string, execution: { attempt_id: string; session_id: string; status: string } | null, state = "running") =>
  http.get(`${graph}/${id}/work`, () => HttpResponse.json({ ...task, data: { task_id: id, task_state: "active", version: "1", readiness: { state, blockers: [], complete: true }, parent: null, execution: execution && { task_id: id, ...execution } } }));

test("aq-server #99: the server's held example reads Held with AQ's reason, in the badge, Status and the list row", async () => {
  // work.json is the base fixture task's work read (same project and task IDs).
  server.use(http.get(`${graph}/${workExample.data.task_id}/work`, () => HttpResponse.json(workExample)));
  const { region } = await open(workExample.data.task_id);
  const badge = await within(region).findByText(/^Held/, { selector: "[data-task-status] span" });
  expect(badge).toHaveTextContent("Held · cancelled attempt holds it");
  expect(badge).not.toHaveTextContent(/Held by a/);
  const chip = badge.closest("[data-task-status]")!;
  expect(chip).toHaveAttribute("data-status", "held"); expect(chip).toHaveAttribute("data-readiness", "held");
  expect(chip).toHaveAttribute("title", workExample.data.readiness.reasons[0]!.message);
  const status = section(region, "Status");
  const reasons = within(status).getByRole("list", { name: "Why the task is held" });
  expect(within(reasons).getByText(workExample.data.readiness.reasons[0]!.message)).toBeVisible();
  expect(reasons.querySelector("[data-hold-reason=cancelled_attempt_holds_task]")).not.toBeNull();
  // The reason names the holding attempt shown below, so it isn't repeated.
  expect(within(reasons).queryByRole("button", { name: "Copy held attempt ID" })).toBeNull();
  expect(within(status).getByText(/AQ isn't running this task/)).toBeVisible();
  // The client-side fallback sentence is not used when AQ itself says held.
  expect(status.querySelector("[data-held-reason]")).toBeNull();
  expect(within(status).getByRole("link", { name: "Open session" })).toHaveAttribute("href", expect.stringContaining(`/agents/${workExample.data.execution.session_id}`));
  expect(within(status).queryByRole("link", { name: "Open terminal" })).toBeNull();
  // The list row of the inspected task follows AQ's held (the list page itself carries no readiness).
  const row = within(screen.getByRole("list", { name: "Tasks" })).getByRole("link", { name: new RegExp(task.data.title) });
  expect(within(row).getByRole("img", { name: "Held" })).toBeVisible();
});

test("W77: a readiness value this bundle doesn't know reads as a neutral Unknown (value), not a failed read", async () => {
  server.use(workRead(FIXTURE_IDS.approve, null, "paused"));
  const { region } = await open(FIXTURE_IDS.approve);
  const badge = await within(region).findByText("Unknown (paused)", { selector: "[data-task-status] span" });
  expect(badge.closest("[data-task-status]")).toHaveAttribute("data-status", "unrecognized");
  expect(within(section(region, "Status")).getByText(/AQ reported the readiness “paused”, which this dashboard version doesn't know/)).toBeVisible();
  expect(within(section(region, "Status")).queryByRole("button", { name: /Retry task readiness/ })).toBeNull();
});

test("aq-server #99: History shows each change's summary and from → to values from the server's example", async () => {
  let example: object = historyExample;
  server.use(http.get(`${graph}/${historyExample.data.task_id}/history`, () => HttpResponse.json(example)));
  const first = await open(historyExample.data.task_id);
  const history = section(first.region, "History");
  await userEvent.click(within(history).getByRole("button", { name: "History" }));
  const list = await within(history).findByRole("list", { name: "Change history" });
  await userEvent.click(within(history).getByRole("button", { name: "Show all 7 changes" }));
  const items = entries(list);
  // Newest first: the undescribed legacy entry (change null) shows only its operation.
  expect(items[0]!.querySelector("[data-history-change]")).toBeNull();
  expect(items[1]).toHaveTextContent("active → completed");
  expect(items[1]!.querySelector("[data-field=task_state]")).toHaveTextContent(/^State active →\s*to completed$/);
  expect(items[4]).toHaveTextContent("priority 0 → 5");
  expect(items[4]!.querySelector("[data-field=priority]")).toHaveTextContent(/^Priority 0 →\s*to 5$/);
  expect(items[3]).toHaveTextContent("added blocks from 00000000");
  expect(within(items[3]!).getByRole("button", { name: "Copy related node ID" })).toBeVisible();
  expect(items[5]!.querySelector("[data-field=task_state]")).toHaveTextContent(/^State active$/);
  expect(within(list).queryByText("Partial")).toBeNull();
  first.unmount();
  // A revision AQ couldn't compare with the previous one is marked partial.
  const partial = structuredClone(historyExample);
  partial.data.items[2]!.change = { summary: "revision changed", fields: [], edge: null, complete: false };
  example = partial;
  const { region } = await open(historyExample.data.task_id);
  const h2 = section(region, "History");
  // The section stays open from the first visit (section memory).
  expect(within(h2).getByRole("button", { name: "History" })).toHaveAttribute("aria-expanded", "true");
  const l2 = await within(h2).findByRole("list", { name: "Change history" });
  await userEvent.click(within(h2).getByRole("button", { name: "Show all 7 changes" }));
  expect(entries(l2)[4]).toHaveTextContent("revision changed Partial");
});

test("aq-server #99: task Results show the worker's process outcome; an unknown value reads Unknown (value)", async () => {
  const { region, unmount } = await open(FIXTURE_IDS.replay);
  const results = section(region, "Results");
  await within(results).findByRole("link", { name: /Replay reconciliation now merges/ });
  expect(within(results).getByText("Process: Succeeded")).toHaveAttribute("data-process-outcome", "success");
  unmount();
  const d = structuredClone(resultsValid.find(f => f.type === "Detail")!.value) as { result: { project_id: string; task_id: string }; revision: { process_outcome?: string; summary: string } };
  d.result.project_id = project; d.result.task_id = FIXTURE_IDS.replay; d.revision.process_outcome = "passed"; d.revision.summary = "Fixture: a future outcome";
  server.use(http.get("/api/v1/results", () => HttpResponse.json({ ...resultsCompat.read, data: { items: [d], next_cursor: null }, scope: { kind: "project", project_id: project } })));
  const other = await open(FIXTURE_IDS.replay);
  const r2 = section(other.region, "Results");
  await within(r2).findByRole("link", { name: "Fixture: a future outcome" });
  expect(within(r2).getByText("Process: Unknown (passed)")).toHaveAttribute("data-process-outcome", "unrecognized");
});

test("P1-01 fallback (server without held): 'running' held by a finished attempt is qualified, never shown as Running", async () => {
  server.use(workRead(FIXTURE_IDS.replay, { attempt_id: fixtureId(0x301), session_id: fixtureId(0x302), status: "finished" }));
  const { region } = await open(FIXTURE_IDS.replay);
  const badge = await within(region).findByText(/^Held by/, { selector: "[data-task-status] span" });
  expect(badge).toHaveTextContent("Held by a finished attempt");
  expect(badge.closest("[data-task-status]")).toHaveAttribute("data-readiness", "running");
  expect(within(region).queryByText("Running", { selector: "[data-task-status] span" })).toBeNull();
  const status = section(region, "Status");
  expect(within(status).getByText(/AQ reports this task as running because the attempt below still holds it, but that attempt is finished/)).toBeVisible();
  // A finished attempt has no live terminal: the link opens its session record.
  expect(within(status).getByRole("link", { name: "Open session" })).toHaveAttribute("href", expect.stringContaining(`/agents/${fixtureId(0x302)}`));
  expect(within(status).queryByRole("link", { name: "Open terminal" })).toBeNull();
});

test("P1-01 fallback: the history read's attempt status qualifies a work read that still says running", async () => {
  server.use(http.get(`${graph}/${FIXTURE_IDS.replay}/history`, () => HttpResponse.json({ ...task, data: { task_id: FIXTURE_IDS.replay, items: [], next_cursor: null, attempts_truncated: false,
    attempts: [{ attempt_id: fixtureId(0x301), session_id: fixtureId(0x302), holds_task: true, status: "finished" }] } })));
  const { region } = await open(FIXTURE_IDS.replay);
  expect(await within(region).findByText("Held by a finished attempt", { selector: "[data-task-status] span" })).toBeVisible();
});

test("P1-01: a live holding attempt still reads Running", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  await within(section(region, "Attempts")).findByRole("list", { name: "Attempts" });
  expect(within(region).getByText("Running", { selector: "[data-task-status] span" })).toBeVisible();
});

test("P1-02: on a phone every action sits in one Task actions menu", async () => {
  const matchMedia = vi.fn((query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.stubGlobal("matchMedia", matchMedia);
  try {
    const { region } = await open(FIXTURE_IDS.approve);
    const header = region.querySelector<HTMLElement>("[data-inspector-bar]")!;
    expect(within(header).getByRole("heading", { level: 2 })).toHaveTextContent("Fixture: Approve recovery plan");
    expect(within(header).queryByRole("button", { name: "Edit task" })).toBeNull();
    await userEvent.click(within(header).getByRole("button", { name: "Task actions" }));
    const menu = screen.getByRole("menu", { name: "Task actions" });
    expect(within(menu).getAllByRole("menuitem").map(i => i.firstChild!.textContent)).toEqual(["Edit task", "Reprioritize", "Cancel task", "Delete task", "Retry attempt", "Add dependency", "Remove dependency"]);
  } finally { vi.unstubAllGlobals(); }
});

test("P1-03: Comments follow Status directly, ahead of the description", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  expect([...region.querySelectorAll("section[data-section]")].map(s => s.getAttribute("data-section")).slice(0, 4)).toEqual(["status", "comments", "description", "acceptance"]);
});

test("P1-04: the inspector publishes a scroll margin for content under its pinned header", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  expect(region.style.getPropertyValue("--inspector-scroll-margin")).toMatch(/^\d+px$/);
});

test("P1-10: a result summary carries its full text as a tooltip (the view clamps it)", async () => {
  const { region } = await open(FIXTURE_IDS.replay);
  const link = await within(section(region, "Results")).findByRole("link", { name: /Replay reconciliation now merges/ });
  expect(link).toHaveAttribute("title", link.textContent);
});

test("P1-11: closing Reprioritize returns focus to the action menu", async () => {
  const { region } = await open(FIXTURE_IDS.approve);
  const more = within(region).getByRole("button", { name: "More actions" });
  await userEvent.click(more);
  await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Reprioritize" }));
  const dialog = screen.getByRole("dialog", { name: "Reprioritize" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  await waitFor(() => expect(more).toHaveFocus());
});

test("P1-11: deleting a comment moves focus to its placeholder; Cancel and Keep it return to the button", async () => {
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = () => entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item()).getByRole("button", { name: /^Edit/ }));
  await userEvent.click(within(item()).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(within(item()).getByRole("button", { name: /^Edit/ })).toHaveFocus());
  await userEvent.click(within(item()).getByRole("button", { name: /^Delete/ }));
  await userEvent.click(within(item()).getByRole("button", { name: "Keep it" }));
  await waitFor(() => expect(within(item()).getByRole("button", { name: /^Delete/ })).toHaveFocus());
  await userEvent.click(within(item()).getByRole("button", { name: /^Delete/ }));
  await userEvent.click(within(item()).getByRole("button", { name: "Delete comment" }));
  await waitFor(() => expect(item()).toHaveTextContent("Comment deleted"));
  await waitFor(() => expect(item()).toHaveFocus());
});

/** A thread whose one owner comment the test changes "in another tab" while it is being edited. */
function editableThread() {
  const at = "2026-10-31T11:00:00.000Z";
  const state = { revision: "1", body: "Fixture: v1 body", posts: [] as { kind: string; expected_revision?: string; body?: string }[] };
  const comment = () => ({ comment_id: fixtureId(0x550), task_id: FIXTURE_IDS.approve, author: { kind: "owner", user_id: fixtureId(0xa1), display_name: "owner@example.test", session_id: null, attempt_id: null },
    body: state.body, created_at: at, edited_at: state.revision === "1" ? null : at, deleted_at: null, revision: state.revision, can_edit: true });
  const handlers = [
    http.get(`${graph}/${FIXTURE_IDS.approve}/comments`, () => HttpResponse.json({ ...task, data: { task_id: FIXTURE_IDS.approve, items: [comment()], next_cursor: null } })),
    http.post("/api/v1/actions", async ({ request }) => {
      const body = await request.json() as { operation_id: string; kind: string; subject: unknown; payload: { project_id: string; expected_revision?: string; body?: string } };
      state.posts.push({ kind: body.kind, expected_revision: body.payload.expected_revision, body: body.payload.body });
      const stale = body.payload.expected_revision !== state.revision;
      if (!stale) { state.revision = String(Number(state.revision) + 1); state.body = body.payload.body!; }
      return HttpResponse.json({ api_version: "dashboard-actions-1", request_id: "x", data: { operation_id: body.operation_id, disposition: stale ? "conflict" : "confirmed", request_digest: `sha256:${"0".repeat(64)}`, scope: { kind: "project", project_id: body.payload.project_id },
        created_at: at, updated_at: at, subject_refs: [body.subject], receipt_refs: [], affected_entities: [], recovery: stale ? "refresh_and_review" : "none", ...(stale ? { current_versions: { task_comment: state.revision } } : {}) } });
    }),
  ];
  return { state, handlers, outOfBand(body: string) { state.revision = String(Number(state.revision) + 1); state.body = body; } };
}

test("P1-06: after an edit conflict the newer version is shown and Save waits for a choice; a second Save never overwrites unseen", async () => {
  const thread = editableThread();
  server.use(...thread.handlers);
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = () => entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item()).getByRole("button", { name: /^Edit/ }));
  thread.outOfBand("v2, edited out-of-band");
  const editor = within(item()).getByLabelText("Edit comment");
  await userEvent.clear(editor); await userEvent.type(editor, "my v3 draft");
  await userEvent.click(within(item()).getByRole("button", { name: "Save" }));
  const conflict = await within(item()).findByRole("group", { name: "Newer version of this comment" });
  expect(within(conflict).getByText("v2, edited out-of-band")).toBeVisible();
  expect(within(item()).getByLabelText("Edit comment")).toHaveValue("my v3 draft");
  const save = within(item()).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  await userEvent.click(save);
  expect(thread.state.posts).toHaveLength(1);
  expect(thread.state.body).toBe("v2, edited out-of-band");
  // Choosing AQ's version puts it in the box; saving from there targets the revision the user has now seen.
  await userEvent.click(within(conflict).getByRole("button", { name: "Use AQ's version" }));
  expect(within(item()).getByLabelText("Edit comment")).toHaveValue("v2, edited out-of-band");
  await userEvent.type(within(item()).getByLabelText("Edit comment"), " + mine");
  await userEvent.click(within(item()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(item()).toHaveTextContent("v2, edited out-of-band + mine"));
  expect(thread.state.posts.map(p => p.expected_revision)).toEqual(["1", "2"]);
});

test("P1-06: Keep my draft is an explicit overwrite of the version shown", async () => {
  const thread = editableThread();
  server.use(...thread.handlers);
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = () => entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item()).getByRole("button", { name: /^Edit/ }));
  thread.outOfBand("v2 elsewhere");
  await userEvent.type(within(item()).getByLabelText("Edit comment"), " plus mine");
  await userEvent.click(within(item()).getByRole("button", { name: "Save" }));
  await userEvent.click(await within(item()).findByRole("button", { name: "Keep my draft" }));
  await userEvent.click(within(item()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(item()).toHaveTextContent("Fixture: v1 body plus mine"));
  expect(thread.state.posts.map(p => p.expected_revision)).toEqual(["1", "2"]);
});

test("P1-06: an untouched draft follows a newer version instead of conflicting", async () => {
  const thread = editableThread();
  server.use(...thread.handlers);
  const { region } = await open(FIXTURE_IDS.approve);
  const comments = section(region, "Comments");
  await within(comments).findByRole("list", { name: "Comments" });
  const item = () => entries(within(comments).getByRole("list", { name: "Comments" }))[0]!;
  await userEvent.click(within(item()).getByRole("button", { name: /^Edit/ }));
  thread.outOfBand("v2 elsewhere");
  await userEvent.click(within(comments).getByRole("button", { name: "Refresh comments" }));
  await waitFor(() => expect(within(item()).getByLabelText("Edit comment")).toHaveValue("v2 elsewhere"));
  expect(within(item()).getByRole("status")).toHaveTextContent("the box now holds the newer version");
  expect(within(item()).queryByRole("group", { name: "Newer version of this comment" })).toBeNull();
});

test("P1-05: comment bodies render safe links and quotes", async () => {
  server.use(http.get(`${graph}/${FIXTURE_IDS.approve}/comments`, () => HttpResponse.json({ ...task, data: { task_id: FIXTURE_IDS.approve, next_cursor: null, items: [{ comment_id: fixtureId(0x551), task_id: FIXTURE_IDS.approve,
    author: { kind: "owner", user_id: fixtureId(0xa1), display_name: "owner@example.test", session_id: null, attempt_id: null }, body: "See [the log](https://example.com/log) or https://example.org/x.\n\n> quoted\n\n<script>alert(1)</script>",
    created_at: "2026-10-31T11:00:00.000Z", edited_at: null, deleted_at: null, revision: "1", can_edit: true }] } })));
  const { region } = await open(FIXTURE_IDS.approve);
  const thread = await within(section(region, "Comments")).findByRole("list", { name: "Comments" });
  expect(within(thread).getByRole("link", { name: "the log" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(thread).getByRole("link", { name: "https://example.org/x" })).toHaveAttribute("target", "_blank");
  expect(thread.querySelector("blockquote")).toHaveTextContent("quoted");
  expect(thread.querySelector("script")).toBeNull();
  expect(thread).toHaveTextContent("<script>alert(1)</script>");
});
