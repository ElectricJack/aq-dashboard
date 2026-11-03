/**
 * Mock-only sample data for DASHBOARD-PROPOSED D04 read models.
 * Illustrative values; never shipped in a live build.
 */
import type {
  Overview,
  ProjectRef,
  ReadinessState,
  SearchResults,
  SessionDetail,
  TaskState,
  TaskSummary,
} from "../api/wire/proposed";

export const SERVER_TIME = "2026-10-31T12:00:00.000Z";
const at = (minutesAgo: number) => new Date(Date.parse(SERVER_TIME) - minutesAgo * 60_000).toISOString();

export const PROJECTS: ProjectRef[] = [
  { id: "agent-queue", label: "agent-queue" },
  { id: "matter-engine", label: "matter-engine" },
  { id: "quilt-trader", label: "quilt-trader" },
  { id: "outrider", label: "outrider" },
];
const project = (id: string) => PROJECTS.find((p) => p.id === id)!;

type Seed = {
  id: string;
  title: string;
  project: string;
  state: TaskState;
  readiness: ReadinessState;
  explanation: string;
  session?: string;
  agent?: string;
  blocker?: { kind: string; explanation: string };
  minutesAgo: number;
};

/** Ids and titles match the labelled human-graph fixture (src/mocks/humanGraph.ts). */
const RECOVERY: Seed[] = [
  { id: "00000000-0000-0000-0000-000000000102", title: "Fixture: Define lease contract", project: "agent-queue", state: "completed", readiness: "done", explanation: "Accepted at revision 2", minutesAgo: 240 },
  { id: "00000000-0000-0000-0000-000000000103", title: "Fixture: Recovery test fixtures", project: "agent-queue", state: "completed", readiness: "done", explanation: "Accepted at revision 1", minutesAgo: 200 },
  { id: "00000000-0000-0000-0000-000000000104", title: "Fixture: Approve recovery plan", project: "agent-queue", state: "active", readiness: "needs_decision", explanation: "Waiting for your review of revision 3", blocker: { kind: "decision", explanation: "Approval of revision 3 required" }, minutesAgo: 18 },
  { id: "00000000-0000-0000-0000-000000000105", title: "Fixture: Replay reconciliation", project: "agent-queue", state: "active", readiness: "running", explanation: "Attempt 27 is running on worker-07", session: "sess-07", agent: "Worker 07", minutesAgo: 1 },
  { id: "00000000-0000-0000-0000-000000000106", title: "Fixture: Implement safe recovery", project: "agent-queue", state: "active", readiness: "waiting", explanation: "Blocked by Approve recovery plan", blocker: { kind: "dependency", explanation: "Waiting on review of Approve recovery plan" }, minutesAgo: 18 },
  { id: "00000000-0000-0000-0000-000000000107", title: "Fixture: Validate crash recovery", project: "agent-queue", state: "active", readiness: "waiting", explanation: "Blocked by Implement safe recovery", blocker: { kind: "dependency", explanation: "Waiting on Implement safe recovery" }, minutesAgo: 17 },
];

const EXTRA: Seed[] = [
  { id: "qt-201", title: "Choose retry policy", project: "quilt-trader", state: "active", readiness: "needs_decision", explanation: "Question awaiting your answer", blocker: { kind: "decision", explanation: "Answer required" }, minutesAgo: 9 },
  { id: "me-301", title: "Resolve integration conflict", project: "matter-engine", state: "active", readiness: "failed", explanation: "Attempt 4 failed: merge conflict in renderer", blocker: { kind: "failure", explanation: "Integration conflict blocks delivery" }, minutesAgo: 6 },
  { id: "me-302", title: "Renderer fix", project: "matter-engine", state: "completed", readiness: "done", explanation: "Merged", minutesAgo: 8 },
  { id: "me-303", title: "Terrain material pass", project: "matter-engine", state: "active", readiness: "running", explanation: "Attempt 2 is running on worker-12", session: "sess-12", agent: "Worker 12", minutesAgo: 2 },
];

const VERBS = ["Audit", "Refactor", "Document", "Benchmark", "Harden", "Migrate", "Profile", "Simplify"];
const NOUNS = ["scheduler", "mailbox", "workspace pool", "telemetry", "cache layer", "CLI help", "artifact store", "auth guard"];
const FILLER: Seed[] = Array.from({ length: 36 }, (_, i) => {
  const readiness: ReadinessState = (["ready", "running", "waiting", "done", "draft", "blocked"] as const)[i % 6]!;
  const state: TaskState = readiness === "done" ? "completed" : readiness === "draft" ? "draft" : "active";
  const running = readiness === "running";
  return {
    id: `t-${400 + i}`,
    title: `${VERBS[i % VERBS.length]} ${NOUNS[(i * 3) % NOUNS.length]}`,
    project: PROJECTS[i % PROJECTS.length]!.id,
    state,
    readiness,
    explanation:
      readiness === "ready" ? "Eligible; waiting for a worker slot"
      : running ? `Attempt 1 is running on worker-${20 + i}`
      : readiness === "waiting" ? "Waiting on an upstream task"
      : readiness === "blocked" ? "Blocked by project eligibility"
      : readiness === "done" ? "Accepted"
      : "Draft; not yet submitted",
    ...(running && { session: `sess-${20 + i}`, agent: `Worker ${20 + i}` }),
    ...(readiness === "blocked" && { blocker: { kind: "eligibility", explanation: "Project concurrency limit reached" } }),
    minutesAgo: 30 + i * 7,
  };
});

const SEEDS = [...RECOVERY, ...EXTRA, ...FILLER];

function summary(s: Seed): TaskSummary {
  return {
    id: s.id,
    revision: "3",
    title: s.title,
    project: project(s.project),
    state: s.state,
    readiness: { state: s.readiness, explanation: s.explanation },
    execution: {
      observation: s.session ? "reported_running" : "unknown",
      observed_at: s.session ? at(0.05) : null,
      session_id: s.session ?? null,
      agent_label: s.agent ?? null,
    },
    blocker: s.blocker ?? null,
    latest_result:
      s.readiness === "done"
        ? { id: `res-${s.id}`, revision: "1", summary: `${s.title} accepted`, submitted_at: at(s.minutesAgo) }
        : null,
    updated_at: at(s.minutesAgo),
  };
}

export const TASKS: TaskSummary[] = SEEDS.map(summary);

export function overview(projectId: string | null, empty = false): Overview {
  const inScope = (p: ProjectRef) => !projectId || p.id === projectId;
  const tasks = TASKS.filter((t) => inScope(t.project));
  const count = (r: ReadinessState) => ({ value: tasks.filter((t) => t.readiness.state === r).length, accuracy: "exact" as const });
  const attention: Overview["attention"] = empty
    ? []
    : [
        { id: "att-1", kind: "decision" as const, title: "Approve worker recovery plan", project: project("agent-queue"), reason: "Review", impact: "Unblocks 4 tasks", since: at(18), subject: { type: "task", id: "00000000-0000-0000-0000-000000000104", revision: "3" }, action: { kind: "decision.respond", subject: { type: "decision", id: "dec-1", revision: "3" }, allowed: true, expected_versions: { decision: "3" } } },
        { id: "att-2", kind: "question" as const, title: "Choose retry policy", project: project("quilt-trader"), reason: "Question", impact: "Unblocks 2 tasks", since: at(9), subject: { type: "task", id: "qt-201", revision: "3" }, action: { kind: "decision.respond", subject: { type: "decision", id: "dec-2", revision: "1" }, allowed: true, expected_versions: { decision: "1" } } },
        { id: "att-3", kind: "failed" as const, title: "Resolve integration conflict", project: project("matter-engine"), reason: "Failure", impact: "Blocks delivery", since: at(6), subject: { type: "task", id: "me-301", revision: "3" }, action: null },
      ].filter((a) => inScope(a.project));
  return {
    counts: {
      running: count("running"),
      ready: count("ready"),
      needs_you: { value: attention.length, accuracy: "exact" },
      recovering: { value: null, accuracy: "unknown" },
    },
    attention,
    in_motion: PROJECTS.filter(inScope).map((p, i) => ({
      project: p,
      running: { value: tasks.filter((t) => t.project.id === p.id && t.readiness.state === "running").length, accuracy: "exact" as const },
      next_constraint: [
        { kind: "decision", explanation: "Review required" },
        { kind: "failure", explanation: "Integration conflict" },
        { kind: "decision", explanation: "Needs your answer" },
        null,
      ][i] ?? null,
      last_progress_at: at(1 + i),
    })),
    recent_outcomes: [
      { subject: { type: "task", id: "00000000-0000-0000-0000-000000000102", revision: "3", title: "Session recovery tests passed" }, project: project("agent-queue"), outcome: "result_accepted" as const, at: at(3) },
      { subject: { type: "task", id: "me-302", revision: "3", title: "Renderer fix" }, project: project("matter-engine"), outcome: "merged" as const, at: at(8) },
    ].filter((r) => inScope(r.project)),
  };
}

const SESSION_SEEDS = TASKS.filter((t) => t.execution.session_id);
export const SESSIONS: SessionDetail[] = SESSION_SEEDS.map((t, i) => ({
  id: t.execution.session_id!,
  label: t.execution.agent_label!,
  task: { type: "task", id: t.id, revision: t.revision, title: t.title },
  attempt_id: `att-${t.id}`,
  project: t.project,
  profile: i % 2 === 0
    ? { provider: "anthropic", model: "claude-opus-5-5", harness: "claude-code" }
    : { provider: "openai", model: "gpt-5.3-codex", harness: "codex" },
  authority: i === 0 ? "central" : "remote",
  observation: {
    state: "reported_running",
    observed_at: at(i === 2 ? 5 : 0.05),
    fresh_until: i === 2 ? at(4) : at(-0.5),
  },
  wait: null,
  controller: i === 1 ? { state: "held", label: "Sample Owner" } : { state: "none", label: null },
  terminal: { type: "terminal", id: `term-${t.execution.session_id}` },
  profile_revisions: [
    { name: "agent profile", revision: "4" },
    { name: "intelligence profile", revision: "2" },
  ],
  permissions: ["read workspace", "run tests", "submit result"],
  last_activity_at: at(0.05),
}));

export function search(q: string, projectId: string | null): SearchResults {
  const needle = q.trim().toLowerCase();
  if (!needle) return { groups: [] };
  const inScope = (p: ProjectRef | null) => !projectId || p?.id === projectId;
  const taskHits = TASKS.filter((t) => inScope(t.project) && t.title.toLowerCase().includes(needle));
  const sessionHits = SESSIONS.filter((s) => inScope(s.project) && `${s.label} ${s.task?.title ?? ""}`.toLowerCase().includes(needle));
  const groups: SearchResults["groups"] = [];
  if (taskHits.length) {
    groups.push({
      type: "task",
      hits: taskHits.slice(0, 5).map((t) => ({ ref: { type: "task", id: t.id, revision: t.revision }, title: t.title, excerpt: t.readiness.explanation, project: t.project })),
      has_more: taskHits.length > 5,
    });
  }
  if (sessionHits.length) {
    groups.push({
      type: "session",
      hits: sessionHits.slice(0, 5).map((s) => ({ ref: { type: "session", id: s.id }, title: s.label, excerpt: s.task?.title ?? "", project: s.project })),
      has_more: sessionHits.length > 5,
    });
  }
  return { groups };
}
