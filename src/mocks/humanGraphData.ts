import fixture from "../../contracts/live/human-graph/examples/task.json";
import { type GraphEdge, type GraphNode } from "../api/adapters/humanGraph";

// Explicitly labelled sample records derived from the pinned owner example.
// Titles mirror design reference 02 (Work explorer); bodies say they are fixtures.
export const fixtureProject = fixture.project;
const base = fixture.data as GraphNode;
const FIXTURE_NOTE = "Mock-mode fixture mirroring design reference 02 (Work explorer). Not live AQ data.";
export const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const task = (n: number, title: string, task_state: string, extra: Partial<GraphNode> = {}): GraphNode =>
  ({
    ...base,
    ...extra,
    id: id(n),
    title,
    task_state,
    body: `${FIXTURE_NOTE}\n\n${extra.body ?? ""}`.trim(),
    kind: "task",
  }) as GraphNode;
export const ID = {
  parent: id(0x101),
  lease: id(0x102),
  fixtures: id(0x103),
  approve: id(0x104),
  replay: id(0x105),
  implement: id(0x106),
  validate: id(0x107),
  legacy: id(0x108),
};
export const FIXTURE_IDS = ID;

/** Ten tasks covering draft, active, completed and canceled states. Index 0/1 stay the original pinned pair. */
export const fixtureTasks: GraphNode[] = [
  { ...base, story_points: 3 },
  {
    ...base,
    story_points: 8,
    id: id(4),
    title: "Fixture: verify recovery",
    body: "Deterministic fixture for dependency navigation.",
    kind: "task",
  } as GraphNode,
  task(0x101, "Fixture: Worker recovery", "active", {
    body: "Parent fixture task grouping the recovery work.",
  }),
  task(0x102, "Fixture: Define lease contract", "completed", {
    acceptance_criteria: "Lease fields and expiry rules are written down.",
  }),
  task(0x103, "Fixture: Recovery test fixtures", "completed", {
    acceptance_criteria: "Crash and replay fixtures exist.",
  }),
  task(0x104, "Fixture: Approve recovery plan", "active", {
    story_points: 3,
    acceptance_criteria: "An operator approves the recovery plan.",
  }),
  task(0x105, "Fixture: Replay reconciliation", "active", {
    story_points: 5,
    acceptance_criteria: "Replayed events reconcile with recorded state.",
  }),
  task(0x106, "Fixture: Implement safe recovery", "draft", {
    story_points: 8,
    acceptance_criteria: "Recovery never runs two current executions.",
  }),
  task(0x107, "Fixture: Validate crash recovery", "draft", {
    story_points: 2,
    acceptance_criteria: "Crash tests pass against the approved plan.",
  }),
  task(0x108, "Fixture: Retire legacy lease path", "canceled", {
    body: "Canceled: superseded by the safe recovery implementation.",
  }),
];
const edge = (
  n: number,
  { source, target }: Pick<GraphEdge, "source" | "target">,
  edge_type: string,
  description: string | null,
): GraphEdge => ({
  id: id(0x200 + n),
  source,
  target,
  edge_type,
  description,
  version: "1",
  source_revision: "1",
  target_revision: "1",
});
const children = fixtureTasks.filter((t) => t.id !== ID.parent);
export const fixtureEdges: GraphEdge[] = [
  {
    ...edge(0, { source: fixtureTasks[0]!.id, target: fixtureTasks[1]!.id }, "blocks", "Fixture dependency"),
    id: id(6),
  },
  ...children.map((t, i) => edge(1 + i, { source: ID.parent, target: t.id }, "parent-child", null)),
  edge(20, { source: ID.lease, target: ID.approve }, "blocks", "Lease contract precedes plan approval"),
  edge(21, { source: ID.approve, target: ID.implement }, "blocks", "Plan approval precedes implementation"),
  edge(22, { source: ID.implement, target: ID.validate }, "blocks", "Implementation precedes validation"),
  edge(23, { source: ID.fixtures, target: ID.replay }, "blocks", "Fixtures precede replay"),
  edge(
    24,
    { source: ID.replay, target: ID.approve },
    "references",
    "Reconciliation findings inform the plan",
  ),
  edge(
    25,
    { source: ID.implement, target: ID.legacy },
    "supersedes",
    "Safe recovery replaces the legacy path",
  ),
  edge(
    26,
    { source: ID.validate, target: fixtureTasks[0]!.id },
    "references",
    "Validation uses the inspection contract",
  ),
];
/** Large scenario: 120 generated children of the parent, for omitted-count states. */
const generated = Array.from({ length: 120 }, (_, i) =>
  task(0x10000 + i, `Fixture (large): generated task ${String(i + 1).padStart(3, "0")}`, "draft"),
);
export const largeTasks = [...fixtureTasks, ...generated];
export const largeEdges = [
  ...fixtureEdges,
  ...generated.map((t, i) => edge(0x1000 + i, { source: ID.parent, target: t.id }, "parent-child", null)),
];

export const knowledge: GraphNode = {
  ...base,
  id: id(5),
  kind: "knowledge",
  title: "Fixture: execution ownership",
  body: "# Decision\nEach attempt has one current execution authority.\n\n## Why this matters\nProcess observations are recorded separately.",
  task_state: null,
  content_type: "decision",
} as GraphNode;
const MAX_NODES = 64;
const zero = { draft: "0", active: "0", completed: "0", canceled: "0", unknown: "0" };
export const countStates = (nodes: GraphNode[]) =>
  nodes.reduce(
    (c, n) => {
      const k = (n.task_state ?? "unknown") as keyof typeof zero;
      return { ...c, [k]: String(Number(c[k]) + 1) };
    },
    { ...zero },
  );
export function parentOf(id: string, tasks: GraphNode[], edges: GraphEdge[]) {
  const e = edges.find((x) => x.edge_type === "parent-child" && x.target === id);
  if (!e) return null;
  const p = tasks.find((t) => t.id === e.source);
  return {
    id: e.source,
    kind: p ? "task" : null,
    title: p?.title ?? null,
    task_state: p?.task_state ?? null,
    edge_id: e.id,
  };
}
/** One-hop neighborhood of `root`, bounded by the adapter's node limit, with what it left out (X9, X10). */
export function neighborhood(root: string, tasks: GraphNode[], edges: GraphEdge[]) {
  const touching = edges.filter((e) => e.source === root || e.target === root);
  const near = [root, ...new Set(touching.map((e) => (e.source === root ? e.target : e.source)))];
  const kept = new Set(near.slice(0, MAX_NODES)),
    dropped = tasks.filter((t) => near.slice(MAX_NODES).includes(t.id));
  const keptEdges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  return {
    root_id: root,
    nodes: tasks.filter((t) => kept.has(t.id)),
    edges: keptEdges,
    truncated: near.length > MAX_NODES,
    parent: parentOf(root, tasks, edges),
    omitted: {
      tasks: String(dropped.length),
      tasks_by_state: countStates(dropped),
      other_nodes: "0",
      edges: String(touching.length - keptEdges.filter((e) => e.source === root || e.target === root).length),
      exact: true,
    },
    expansion: null,
  };
}
/** What the fixture's holding attempt ran with (aq-server spec 0014 §7.1), the same on the work, history, list and session reads. */
export const FIXTURE_RAN_WITH = {
  role: "developer",
  level: "standard-high",
  provider: "anthropic",
  model: "claude-opus-5-5",
  reasoning: "high",
  harness: "claude-code",
  execution_profile: "fixture-sandbox",
  snapshot_digest: "f".repeat(64),
};
/** Fixture attempts: "Replay reconciliation" holds one and had a failed one; "Worker recovery" had one that ended. */
export const FIXTURE_ATTEMPTS: Record<
  string,
  { attempt_id: string; session_id: string; holds_task: boolean; status: string }[]
> = {
  [ID.replay]: [
    { attempt_id: id(0x301), session_id: id(0x302), holds_task: true, status: "running" },
    { attempt_id: id(0x305), session_id: id(0x306), holds_task: false, status: "failed" },
  ],
  [ID.parent]: [{ attempt_id: id(0x303), session_id: id(0x304), holds_task: false, status: "failed" }],
};
/** Labelled session details for the fixture attempts (`GET /api/v1/sessions/{id}`). */
export const FIXTURE_ATTEMPT_SESSIONS = [
  {
    sid: id(0x302),
    attempt: id(0x301),
    task: ID.replay,
    provider: "anthropic",
    model: "claude-opus-5-5",
    harness: "claude-code",
    started: "2026-10-31T11:40:00.000Z",
    stopped: null,
  },
  {
    sid: id(0x306),
    attempt: id(0x305),
    task: ID.replay,
    provider: "openai",
    model: "gpt-5.3-codex",
    harness: "codex",
    started: "2026-10-31T10:05:00.000Z",
    stopped: "2026-10-31T10:31:00.000Z",
  },
  {
    sid: id(0x304),
    attempt: id(0x303),
    task: ID.parent,
    provider: "anthropic",
    model: "claude-opus-5-5",
    harness: "claude-code",
    started: "2026-10-31T09:00:00.000Z",
    stopped: "2026-10-31T09:20:00.000Z",
  },
].map((s) => ({
  id: s.sid,
  label: `Fixture attempt session ${s.sid.slice(-4)}`,
  task: { type: "task", id: s.task, revision: "1", title: fixtureTasks.find((t) => t.id === s.task)!.title },
  attempt_id: s.attempt,
  project: { id: fixture.project.id, label: fixture.project.name },
  profile: { provider: s.provider, model: s.model, harness: s.harness },
  authority: "remote" as const,
  observation: {
    state: "unknown" as const,
    observed_at: "2026-10-31T12:00:00.000Z",
    fresh_until: "2026-10-31T12:01:00.000Z",
  },
  wait: null,
  controller: { state: "none" as const, label: null },
  terminal: null,
  lifecycle: { started_at: s.started, stopped_at: s.stopped },
  profile_revisions: [],
  permissions: [],
  last_activity_at: null,
  // aq-server 09ee5e98: the session of an attempt with a `ran_with` record carries it; the older attempts have none.
  ...(s.attempt === id(0x301) ? { ran_with: FIXTURE_RAN_WITH } : {}),
}));
function historyOperation(index: number) {
  if (index === 0) return { category: "revision", operation: "create_node" };
  if (index % 5 === 4) return { category: "lifecycle", operation: "set_task_state" };
  if (index % 3 === 2) return { category: "edge", operation: "add_edge" };
  return { category: "revision", operation: "update_node" };
}
/** Fixture change history: a create, edits and lifecycle changes, oldest first as Graph serves it. "Replay reconciliation" has 30 entries (two pages). */
export function historyFor(node: GraphNode) {
  const count = node.id === ID.replay ? 30 : 4,
    base = Date.parse("2026-10-30T09:00:00.000Z");
  return Array.from({ length: count }, (_, i) => ({
    sequence: String(1000 + i),
    entry_id: id(0x400000 + parseInt(node.id.slice(-6), 16) * 64 + i),
    ...historyOperation(i),
    actor_id: i % 2 ? "fixture-agent-session" : "owner@example.test",
    reason:
      i === 0
        ? "Fixture: created from the recovery plan"
        : i % 4 === 1
          ? `Fixture edit ${i}: tightened the acceptance criteria`
          : null,
    created_at: new Date(base + i * 37 * 60_000).toISOString(),
    change: historyChange(i),
  }));
}
/** What each fixture entry changed (aq-server #99 `change`): values only for state and priority; one partial, one undescribed. */
function historyChange(i: number) {
  const c = (
    summary: string,
    fields: { field: string; from: string | null; to: string | null }[] = [],
    edge: unknown = null,
    complete = true,
  ) => ({ summary, fields, edge, complete });
  if (i === 0) return c("created");
  if (i === 7) return null;
  if (i % 5 === 4) return c("draft → active", [{ field: "task_state", from: "draft", to: "active" }]);
  if (i % 3 === 2)
    return c(`added blocks from ${ID.fixtures.slice(0, 8)}`, [], {
      edge_type: "blocks",
      direction: "incoming",
      node_id: ID.fixtures,
    });
  if (i === 1) return c("revision changed", [], null, false);
  return i % 2
    ? c("acceptance criteria", [{ field: "acceptance_criteria", from: null, to: null }])
    : c(`priority ${i - 2} → ${i}; title`, [
        { field: "priority", from: String(i - 2), to: String(i) },
        { field: "title", from: null, to: null },
      ]);
}
/* Task comments (spec 0004 §4.1): "Replay reconciliation" has 57 (two pages of 50) from an agent, the supervisor,
 * the system and the owner, including a deleted one; "Approve recovery plan" has one owner comment. */
export type FixtureComment = {
  comment_id: string;
  task_id: string;
  author: {
    kind: string;
    user_id: string | null;
    display_name: string | null;
    session_id: string | null;
    attempt_id: string | null;
  };
  body: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  revision: string;
  can_edit: boolean;
};
export type FixtureRouteEntry = {
  sequence: number;
  at_ms: number;
  route: null | {
    class: string;
    harnesses: string[];
    providers: string[];
    prefer: string[];
    lane: string | null;
    provider_intent: string;
    reasons: { code: string; detail: string }[];
    classification: null;
    policy_digest: string | null;
    structure_revision: number | null;
    source: string;
  };
};
export const OWNER = {
  kind: "owner",
  user_id: id(0xa1),
  display_name: "owner@example.test",
  session_id: null,
  attempt_id: null,
};
export function fixtureComments(): Map<string, FixtureComment[]> {
  const at = (minutesAgo: number) =>
    new Date(Date.parse("2026-10-31T12:00:00.000Z") - minutesAgo * 60_000).toISOString();
  const c = (
    n: number,
    task: string,
    author: FixtureComment["author"],
    body: string | null,
    minutesAgo: number,
    extra: Partial<FixtureComment> = {},
  ): FixtureComment => ({
    comment_id: id(0x500 + n),
    task_id: task,
    author,
    body,
    created_at: at(minutesAgo),
    edited_at: null,
    deleted_at: null,
    revision: "1",
    can_edit: author.kind === "owner" && body !== null,
    ...extra,
  });
  const agent = {
    kind: "agent",
    user_id: null,
    display_name: null,
    session_id: id(0x306),
    attempt_id: id(0x305),
  };
  const replay = [
    c(1, ID.replay, OWNER, "Fixture: please also check the **phone** layout before closing this.", 4, {
      edited_at: at(2),
      revision: "2",
    }),
    c(
      2,
      ID.replay,
      { kind: "supervisor", user_id: null, display_name: null, session_id: id(0x302), attempt_id: null },
      "Fixture: retried after the first attempt failed on the ledger merge.",
      20,
    ),
    c(3, ID.replay, OWNER, null, 35, { deleted_at: at(30), revision: "2", can_edit: false }),
    c(
      4,
      ID.replay,
      agent,
      "Fixture finding: the replay drops duplicate ledger entries.\n\n- see `ledger/merge.rs`\n- reproduced with the crash fixture",
      95,
    ),
    c(
      5,
      ID.replay,
      { kind: "system", user_id: null, display_name: "aq-scheduler", session_id: null, attempt_id: null },
      "Fixture: attempt 00000000…0305 ended: failed.",
      100,
    ),
    ...Array.from({ length: 52 }, (_, i) =>
      c(10 + i, ID.replay, agent, `Fixture progress note ${52 - i}.`, 120 + i * 5),
    ),
  ];
  return new Map([
    [ID.replay, replay],
    [ID.approve, [c(80, ID.approve, OWNER, "Fixture: waiting on the lease contract review.", 60)]],
  ]);
}
