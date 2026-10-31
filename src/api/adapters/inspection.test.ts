import type {
  ActionDescriptor,
  Overview,
  Page,
  SessionSummary,
  TaskDetail,
  TaskGraph,
  TaskSummary,
} from "../wire/proposed";
import {
  adaptAction,
  adaptOverview,
  adaptSearch,
  adaptPage,
  adaptSession,
  adaptTaskDetail,
  adaptTaskGraph,
  adaptTaskSummary,
} from "./inspection";

const T = "2026-10-31T12:00:00.000Z";

function taskSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "task-1",
    revision: "3",
    title: "Replay reconciliation",
    project: { id: "agent-queue", label: "agent-queue" },
    state: "active",
    readiness: { state: "running", explanation: "Attempt 27 is running on worker-07" },
    execution: {
      observation: "reported_running",
      observed_at: T,
      session_id: "sess-7",
      agent_label: "Worker 07",
    },
    blocker: null,
    latest_result: null,
    updated_at: T,
    ...overrides,
  };
}

function action(overrides: Partial<ActionDescriptor> = {}): ActionDescriptor {
  return {
    kind: "decision.respond",
    subject: { type: "decision", id: "dec-1", revision: "3" },
    allowed: true,
    expected_versions: { decision: "3" },
    ...overrides,
  };
}

test("keeps a known readiness and its server explanation", () => {
  expect(adaptTaskSummary(taskSummary()).readiness).toEqual({
    state: "running",
    explanation: "Attempt 27 is running on worker-07",
  });
});

test("renders an unknown readiness as unsupported while keeping the explanation", () => {
  const raw = taskSummary();
  (raw.readiness as { state: string }).state = "teleporting";
  expect(adaptTaskSummary(raw).readiness.state).toBe("unsupported");
});

test("renders an unknown task state as unsupported", () => {
  const raw = taskSummary();
  (raw as { state: string }).state = "archived";
  expect(adaptTaskSummary(raw).state).toBe("unsupported");
});

test("rejects a numeric revision", () => {
  const raw = taskSummary();
  (raw as { revision: unknown }).revision = 3;
  expect(() => adaptTaskSummary(raw)).toThrow(/contract/i);
});

test("an action of an unsupported kind is never allowed", () => {
  expect(adaptAction(action({ kind: "graph.rewrite" }))).toMatchObject({
    allowed: false,
    kind: "unsupported",
  });
});

test("a disallowed action keeps the server explanation", () => {
  expect(
    adaptAction(action({ allowed: false, explanation: "Only owners can approve" })),
  ).toMatchObject({ allowed: false, explanation: "Only owners can approve" });
});

test("pages keep cursor, snapshot and total accuracy", () => {
  const page: Page<TaskSummary> = {
    items: [taskSummary()],
    next_cursor: "c2",
    has_more: true,
    snapshot_id: "snap-1",
    total: { value: 120, accuracy: "estimated" },
  };
  expect(adaptPage(page, adaptTaskSummary)).toMatchObject({
    nextCursor: "c2",
    hasMore: true,
    snapshotId: "snap-1",
    total: { value: 120, accuracy: "estimated" },
  });
});

test("an unknown total never becomes zero", () => {
  const page: Page<TaskSummary> = {
    items: [],
    next_cursor: null,
    has_more: false,
    snapshot_id: "s",
    total: { value: 7, accuracy: "unknown" },
  };
  expect(adaptPage(page, adaptTaskSummary).total).toEqual({ value: null, accuracy: "unknown" });
});

function overview(overrides: Partial<Overview> = {}): Overview {
  return {
    counts: {
      running: { value: 12, accuracy: "exact" },
      ready: { value: 7, accuracy: "exact" },
      needs_you: { value: 1, accuracy: "exact" },
      recovering: { value: null, accuracy: "unknown" },
    },
    attention: [
      {
        id: "att-1",
        kind: "decision",
        title: "Approve worker recovery plan",
        project: { id: "agent-queue", label: "agent-queue" },
        reason: "Review",
        impact: "Unblocks 4 tasks",
        since: "2026-10-31T11:42:00.000Z",
        subject: { type: "task", id: "task-2", revision: "3" },
        action: action(),
      },
    ],
    in_motion: [],
    recent_outcomes: [],
    ...overrides,
  };
}

test("an attention item of unknown kind is unsupported and its action disabled", () => {
  const raw = overview();
  (raw.attention[0] as { kind: string }).kind = "omen";
  const item = adaptOverview(raw).attention[0];
  expect(item?.kind).toBe("unsupported");
  expect(item?.action?.allowed).toBe(false);
});

test("overview counts keep unknown as null", () => {
  expect(adaptOverview(overview()).counts.recovering).toEqual({ value: null, accuracy: "unknown" });
});

function detail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...taskSummary(),
    description: "Reconcile replayed receipts.",
    acceptance: { revision: "2", criteria: ["No duplicate receipts"] },
    dependencies: [],
    attempts: [],
    facts: [
      { kind: "source_retained", state: "confirmed", at: T, receipt: { type: "receipt", id: "r1" } },
      { kind: "result_accepted", state: "not_yet", at: null, receipt: null },
      { kind: "merged", state: "unknown", at: null, receipt: null },
    ],
    actions: [],
    ...overrides,
  };
}

test("task facts stay distinct and keep unknown", () => {
  expect(adaptTaskDetail(detail()).facts.map((f) => [f.kind, f.state])).toEqual([
    ["source_retained", "confirmed"],
    ["result_accepted", "not_yet"],
    ["merged", "unknown"],
  ]);
});

test("an unrecognised fact kind is kept as unsupported, not dropped", () => {
  const raw = detail();
  (raw.facts[0] as { kind: string }).kind = "teleported";
  expect(adaptTaskDetail(raw).facts[0]?.kind).toBe("unsupported");
});

function graph(overrides: Partial<TaskGraph> = {}): TaskGraph {
  return {
    root_id: "a",
    nodes: [
      { id: "a", revision: "1", title: "A", state: "active", readiness: { state: "running", explanation: "" } },
      { id: "b", revision: "1", title: "B", state: "completed", readiness: { state: "done", explanation: "" } },
    ],
    edges: [{ from: "b", to: "a", type: "blocks" }],
    omitted: { nodes: 0, edges: 0 },
    ...overrides,
  };
}

test("graph edges to nodes outside the response are dropped and counted as omitted", () => {
  const g = adaptTaskGraph(graph({ edges: [{ from: "b", to: "a", type: "blocks" }, { from: "a", to: "zzz", type: "blocks" }] }));
  expect(g.edges).toHaveLength(1);
  expect(g.omitted.edges).toBe(1);
});

test("graph edge types map to hierarchy, dependency or informational", () => {
  const g = adaptTaskGraph(
    graph({
      edges: [
        { from: "b", to: "a", type: "blocks" },
        { from: "a", to: "b", type: "parent-child" },
        { from: "a", to: "b", type: "references" },
      ],
    }),
  );
  expect(g.edges.map((e) => e.category)).toEqual(["dependency", "hierarchy", "informational"]);
});

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "sess-7",
    label: "Worker 07",
    task: { type: "task", id: "task-1", revision: "3", title: "Replay reconciliation" },
    attempt_id: "att-27",
    project: { id: "agent-queue", label: "agent-queue" },
    profile: { provider: "anthropic", model: "claude-opus-5-5", harness: "claude-code" },
    authority: "remote",
    observation: { state: "reported_running", observed_at: T, fresh_until: "2026-10-31T12:00:30.000Z" },
    wait: null,
    controller: { state: "none", label: null },
    terminal: { type: "terminal", id: "term-7" },
    ...overrides,
  };
}

test("session observation freshness comes from server time", () => {
  expect(adaptSession(session(), "2026-10-31T12:01:00.000Z").observation.freshness).toBe("stale");
  expect(adaptSession(session(), T).observation.freshness).toBe("fresh");
});

test("a session with an unknown controller state is unsupported", () => {
  const raw = session();
  (raw.controller as { state: string }).state = "shared";
  expect(adaptSession(raw, T).controller.state).toBe("unsupported");
});

test("an unrecognised total accuracy is never shown as exact", () => {
  const page: Page<TaskSummary> = {
    items: [], next_cursor: null, has_more: false, snapshot_id: "s",
    total: { value: 5, accuracy: "approximate" as "exact" },
  };
  expect(adaptPage(page, adaptTaskSummary).total).toEqual({ value: 5, accuracy: "estimated" });
});

test("search results are validated and malformed groups are a contract error", () => {
  expect(adaptSearch({ groups: [{ type: "task", hits: [{ ref: { type: "task", id: "a" }, title: "A", excerpt: "", project: null }], has_more: false }] }).groups).toHaveLength(1);
  expect(() => adaptSearch({} as never)).toThrow(/contract/i);
  expect(() => adaptSearch({ groups: [{ type: "task", hits: "nope", has_more: false }] } as never)).toThrow(/contract/i);
});
