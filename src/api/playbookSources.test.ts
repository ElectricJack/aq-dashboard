import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "./client";
import { adaptSourceList, adaptSourceView, PLAYBOOK_DISPLAY_LIMITS, authorPlaybookSourceAgain, deletePlaybookSource, rollBackPlaybookSource, sourceFailure, sourceGap } from "./playbookSources";

const kase = { name: "bug-fix-failed-once", situation: "a bug fix that failed once", result: "class: complex\neffort: high", passed: true };
const active = { artifact: "sha256:" + "a".repeat(64), since_ms: 2, comparison: { change: "behaviour" }, can_rollback: true, previous: { since_ms: 1 }, cases: [kase] };
const latest = { run: "12", status: "saved", question: null, unable: null, refusal: null, internal_task_id: "00000000-0000-4000-8000-000000000001", created_at_ms: 1, finished_at_ms: 2, elapsed_ms: 1 };
/** The shape `aq-playbook-authoring/src/view.rs` serializes. */
const view = { id: "routing", kind: "builtin", binding: "aq.routing", purpose: "Choose the intelligence level for each task", revision: 2, active, latest };

test("adapts the source view the server returns", () => {
  expect(adaptSourceView(view)).toEqual({ id: "routing", kind: "builtin", binding: "aq.routing", purpose: "Choose the intelligence level for each task", revision: 2,
    active: { artifact: active.artifact, since_ms: 2, comparison: { change: "behaviour" }, can_rollback: true, previous: { since_ms: 1, summary: null }, cases: [kase] },
    latest: { run: "12", status: "saved", question: null, unable: null, refusal: null, internal_task_id: latest.internal_task_id, created_at_ms: 1, finished_at_ms: 2, elapsed_ms: 1 } });
  expect(adaptSourceView({ ...view, active: { ...active, previous: { since_ms: 1, summary: "Before." } } }).active?.previous).toEqual({ since_ms: 1, summary: "Before." });
  expect(adaptSourceView({ ...view, active: null, latest: null })).toMatchObject({ active: null, latest: null });
  expect(adaptSourceList({ items: [view, view] })).toHaveLength(2);
});

test("a question carries its sentences in document order with their lines, and the last line of one that spans several", () => {
  const question = { question: "Which wins?", sentences: [{ line: 3, text: "First." }, { line: 9, end_line: 10, text: "Second,\nand more." }] };
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "question", question } }).latest?.question).toEqual({ question: "Which wins?",
    sentences: [{ line: 3, end_line: null, text: "First." }, { line: 9, end_line: 10, text: "Second,\nand more." }] });
});

test("what could not be carried out is one sentence of the document with its line, or a fault in what the server gave the agent", () => {
  const one = { reason: "There is no plotter.", line: 12, sentence: "Art goes to the plotter." };
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "unable", unable: one } }).latest?.unable).toEqual({ ...one, host_fault: false });
  const fault = { reason: "catalog.json is empty.", sentence: "This is a fault in what the server gave the agent, not in your document.", host_fault: true };
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "unable", unable: fault } }).latest?.unable).toEqual({ ...fault, line: null });
  expect(() => adaptSourceView({ ...view, latest: { ...latest, status: "unable", unable: [one] } })).toThrow("Contract violation");
});

test("every status the server names is known, and a failed run keeps its sentence", () => {
  for (const status of ["running", "saved", "question", "unable", "refused", "failed", "superseded"]) expect(adaptSourceView({ ...view, latest: { ...latest, status } }).latest?.status).toBe(status);
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "failed", refusal: "The agent ran out of time before it finished." } }).latest?.refusal).toBe("The agent ran out of time before it finished.");
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "running", finished_at_ms: null, elapsed_ms: 4000 } }).latest).toMatchObject({ finished_at_ms: null, elapsed_ms: 4000 });
});

test("a run state the dashboard does not know is kept as unknown, and no previous playbook means no comparison", () => {
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "paused" } }).latest?.status).toBe("unknown");
  expect(adaptSourceView({ ...view, active: { ...active, comparison: null } }).active?.comparison).toBeNull();
  const { comparison: _omitted, ...bare } = active;
  expect(adaptSourceView({ ...view, active: bare }).active?.comparison).toBeNull();
});

test("refuses a response outside the contract", () => {
  expect(() => adaptSourceView({ ...view, id: 3 })).toThrow("Contract violation");
  const { purpose: _p, ...unnamed } = view; const { elapsed_ms: _e, ...untimed } = latest;
  expect(() => adaptSourceView(unnamed)).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, revision: "2" })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, latest: untimed })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, comparison: { change: "rewritten" } } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, cases: [{ ...kase, passed: "yes" }] } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, latest: { ...latest, question: { question: "Q", sentences: [{ line: "3", text: "x" }] } } })).toThrow("Contract violation");
  expect(() => adaptSourceList({ items: "none" })).toThrow("Contract violation");
});

test("a very large report is shortened, never refused", () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ ...kase, name: `c${i}`, situation: "s".repeat(300_000) }));
  const adapted = adaptSourceView({ ...view, active: { ...active, cases: many }, latest: { ...latest, status: "refused", refusal: "r".repeat(300_000) } });
  expect(adapted.active?.cases).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.items);
  expect(adapted.active?.cases[0]?.situation).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.textChars);
  expect(adapted.latest?.refusal).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.reasonChars);
});

test("a rollback is possible only when the server says so, and what it brings back is named", () => {
  expect(adaptSourceView({ ...view, active: { ...active, can_rollback: false, previous: null, comparison: { change: "none" } } }).active).toMatchObject({ can_rollback: false, previous: null });
  const { can_rollback: _a, previous: _b, ...older } = active;
  expect(adaptSourceView({ ...view, active: older }).active).toMatchObject({ can_rollback: false, previous: null });
  expect(adaptSourceView(view).active).toMatchObject({ can_rollback: true, previous: { since_ms: 1, summary: null } });
  expect(() => adaptSourceView({ ...view, active: { ...active, can_rollback: "yes" } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, since_ms: 9e15 } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, previous: { since_ms: -1 } } })).toThrow("Contract violation");
});

describe("a mutating call", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  test("returns the refreshed view the server sends", async () => {
    server.use(http.post("/api/playbooks/sources/routing/rollback", () => HttpResponse.json(view)), http.post("/api/playbooks/sources/routing/runs", () => HttpResponse.json(view)));
    expect((await rollBackPlaybookSource("routing"))?.id).toBe("routing");
    expect((await authorPlaybookSourceAgain("routing"))?.id).toBe("routing");
  });

  test("an answer that is not a view is outside the contract, and a delete answers nothing of use", async () => {
    server.use(http.post("/api/playbooks/sources/routing/runs", () => HttpResponse.json({ ok: true })), http.delete("/api/playbooks/sources/other", () => HttpResponse.json({ deleted: true })));
    await expect(authorPlaybookSourceAgain("routing")).rejects.toThrow("Contract violation");
    await expect(deletePlaybookSource("other")).resolves.toBeUndefined();
  });

  test("a refusal is still a failure", async () => {
    server.use(http.post("/api/playbooks/sources/routing/rollback", () => HttpResponse.json({ error: "conflict", message: "no" }, { status: 409 })));
    await expect(rollBackPlaybookSource("routing")).rejects.toMatchObject({ serverMessage: "no" });
  });
});

test("no source yet and no playbook engine are said in plain words, never with the server's failure text", () => {
  const missing = new ApiError("http", "AQ responded 404", { status: 404, serverMessage: "There is no playbook source routing" });
  const down = new ApiError("http", "AQ responded 503", { status: 503, serverMessage: "playbooks unavailable: error connecting to engine database: timeout" });
  expect(sourceGap(missing)).toBe("missing"); expect(sourceGap(down)).toBe("unavailable"); expect(sourceGap(new Error("x"))).toBeNull();
  expect(sourceFailure(missing, "f")).toBe("This server has not set up the routing playbook yet, so there is nothing to show.");
  expect(sourceFailure(down, "f")).toMatch(/^Playbooks are not running on this server right now\./);
  expect(sourceFailure(down, "f")).not.toMatch(/database|unavailable:/);
  expect(sourceFailure(new ApiError("http", "AQ responded 409", { status: 409, serverMessage: "There is no earlier playbook to go back to." }), "f")).toBe("There is no earlier playbook to go back to.");
  expect(sourceFailure(new ApiError("transport", "Could not reach AQ"), "A new run could not be started.")).toBe("A new run could not be started.");
});
