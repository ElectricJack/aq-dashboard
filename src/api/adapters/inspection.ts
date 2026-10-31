import type {
  ActionDescriptor,
  SearchResults,
  AttentionItem,
  EdgeType,
  Fact,
  Overview,
  Page,
  ProcessObservation,
  Readiness,
  SessionDetail,
  SessionSummary,
  TaskDetail,
  TaskGraph,
  TaskSummary,
  Total,
} from "../wire/proposed";
import { ContractError, isRecord, isStale } from "./contract";

type Unsupported = "unsupported";

/** Maps a server enum to itself when this client knows it, else "unsupported". */
function known<T extends string>(value: string, allowed: readonly T[]): T | Unsupported {
  return (allowed as readonly string[]).includes(value) ? (value as T) : "unsupported";
}

const REVISION = /^[1-9][0-9]*$/;
function revision(value: unknown, what: string): string {
  if (typeof value !== "string" || !REVISION.test(value)) {
    throw new ContractError(`${what} revision must be a positive decimal string`);
  }
  return value;
}

/* ----- Shared ----- */

export type TotalView = { value: number | null; accuracy: Total["accuracy"] };
const ACCURACIES = ["exact", "estimated", "unknown"] as const;
export function adaptTotal(total: Total): TotalView {
  const accuracy = known(total.accuracy, ACCURACIES);
  if (accuracy === "unknown" || total.value === null || !Number.isFinite(total.value)) {
    return { value: null, accuracy: "unknown" };
  }
  // An accuracy this client doesn't know is never presented as exact.
  return { value: total.value, accuracy: accuracy === "unsupported" ? "estimated" : accuracy };
}

export type PageView<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  snapshotId: string;
  total: TotalView;
};
export function adaptPage<W, V>(page: Page<W>, item: (w: W) => V): PageView<V> {
  if (!Array.isArray(page.items)) throw new ContractError("page items must be a list");
  return {
    items: page.items.map(item),
    nextCursor: page.next_cursor,
    hasMore: page.has_more,
    snapshotId: page.snapshot_id,
    total: adaptTotal(page.total),
  };
}

/** Action kinds this client can present. Anything else is never offered. */
const ACTION_KINDS = ["decision.respond", "task.cancel", "operation.reconcile"] as const;
export type ActionView = {
  kind: (typeof ACTION_KINDS)[number] | Unsupported;
  subject: ActionDescriptor["subject"];
  allowed: boolean;
  explanation: string | null;
};
export function adaptAction(action: ActionDescriptor): ActionView {
  const kind = known(action.kind, ACTION_KINDS);
  return {
    kind,
    subject: action.subject,
    allowed: kind !== "unsupported" && action.allowed,
    explanation: action.explanation ?? null,
  };
}

/* ----- Tasks ----- */

const TASK_STATES = ["draft", "active", "completed", "canceled"] as const;
const READINESS = [
  "draft",
  "ready",
  "running",
  "waiting",
  "blocked",
  "needs_decision",
  "failed",
  "done",
  "canceled",
] as const;
const OBSERVATIONS = ["unknown", "reported_running", "reported_stopped"] as const;

export type ReadinessView = { state: Readiness["state"] | Unsupported; explanation: string };
function adaptReadiness(r: Readiness): ReadinessView {
  return { state: known(r.state, READINESS), explanation: r.explanation };
}

export type TaskSummaryView = {
  id: string;
  revision: string;
  title: string;
  project: TaskSummary["project"];
  state: TaskSummary["state"] | Unsupported;
  readiness: ReadinessView;
  execution: {
    observation: ProcessObservation | Unsupported;
    observedAt: string | null;
    sessionId: string | null;
    agentLabel: string | null;
  };
  blocker: TaskSummary["blocker"];
  latestResult: { id: string; revision: string; summary: string; submittedAt: string } | null;
  updatedAt: string;
};

export function adaptTaskSummary(t: TaskSummary): TaskSummaryView {
  return {
    id: t.id,
    revision: revision(t.revision, "task"),
    title: t.title,
    project: t.project,
    state: known(t.state, TASK_STATES),
    readiness: adaptReadiness(t.readiness),
    execution: {
      observation: known(t.execution.observation, OBSERVATIONS),
      observedAt: t.execution.observed_at,
      sessionId: t.execution.session_id,
      agentLabel: t.execution.agent_label,
    },
    blocker: t.blocker,
    latestResult: t.latest_result && {
      id: t.latest_result.id,
      revision: revision(t.latest_result.revision, "result"),
      summary: t.latest_result.summary,
      submittedAt: t.latest_result.submitted_at,
    },
    updatedAt: t.updated_at,
  };
}

const FACT_KINDS = [
  "source_retained",
  "result_submitted",
  "result_accepted",
  "task_completed",
  "candidate_published",
  "merged",
  "deployed",
] as const;
const FACT_STATES = ["confirmed", "not_yet", "unknown"] as const;
const ATTEMPT_OUTCOMES = ["running", "succeeded", "failed", "canceled", "unknown"] as const;

export type FactView = {
  kind: Fact["kind"] | Unsupported;
  state: Fact["state"] | Unsupported;
  at: string | null;
  receipt: Fact["receipt"];
};

export type TaskDetailView = TaskSummaryView & {
  description: string;
  acceptance: { revision: string; criteria: string[] };
  dependencies: TaskDetail["dependencies"];
  attempts: (Omit<TaskDetail["attempts"][number], "outcome" | "started_at" | "ended_at" | "session_id"> & {
    outcome: TaskDetail["attempts"][number]["outcome"] | Unsupported;
    startedAt: string;
    endedAt: string | null;
    sessionId: string | null;
  })[];
  facts: FactView[];
  actions: ActionView[];
};

export function adaptTaskDetail(t: TaskDetail): TaskDetailView {
  return {
    ...adaptTaskSummary(t),
    description: t.description,
    acceptance: { revision: revision(t.acceptance.revision, "acceptance"), criteria: t.acceptance.criteria },
    dependencies: t.dependencies,
    attempts: t.attempts.map((a) => ({
      id: a.id,
      number: a.number,
      outcome: known(a.outcome, ATTEMPT_OUTCOMES),
      startedAt: a.started_at,
      endedAt: a.ended_at,
      sessionId: a.session_id,
    })),
    facts: t.facts.map((f) => ({
      kind: known(f.kind, FACT_KINDS),
      state: known(f.state, FACT_STATES),
      at: f.at,
      receipt: f.receipt,
    })),
    actions: t.actions.map(adaptAction),
  };
}

/* ----- Graph ----- */

export type EdgeCategory = "hierarchy" | "dependency" | "informational";
const EDGE_CATEGORY: Record<EdgeType, EdgeCategory> = {
  blocks: "dependency",
  "parent-child": "hierarchy",
  references: "informational",
  motivated_by: "informational",
  produces: "informational",
  supports: "informational",
  contradicts: "informational",
  supersedes: "informational",
};

export type TaskGraphView = {
  rootId: string;
  nodes: {
    id: string;
    revision: string;
    title: string;
    state: TaskSummary["state"] | Unsupported;
    readiness: ReadinessView;
  }[];
  edges: { from: string; to: string; type: string; category: EdgeCategory }[];
  omitted: { nodes: number; edges: number; reason: string | null };
};

export function adaptTaskGraph(g: TaskGraph): TaskGraphView {
  const ids = new Set(g.nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  return {
    rootId: g.root_id,
    nodes: g.nodes.map((n) => ({
      id: n.id,
      revision: revision(n.revision, "node"),
      title: n.title,
      state: known(n.state, TASK_STATES),
      readiness: adaptReadiness(n.readiness),
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      // An unknown edge type is shown, but never as a dependency.
      category: EDGE_CATEGORY[e.type] ?? "informational",
    })),
    omitted: {
      nodes: g.omitted.nodes,
      edges: g.omitted.edges + (g.edges.length - edges.length),
      reason: g.omitted.reason ?? null,
    },
  };
}

/* ----- Overview ----- */

const ATTENTION_KINDS = ["decision", "blocked", "failed", "uncertain_operation"] as const;

export type AttentionView = Omit<AttentionItem, "kind" | "action"> & {
  kind: AttentionItem["kind"] | Unsupported;
  action: ActionView | null;
};

export type OverviewView = {
  counts: Record<keyof Overview["counts"], TotalView>;
  attention: AttentionView[];
  inMotion: {
    project: Overview["in_motion"][number]["project"];
    running: TotalView;
    nextConstraint: { kind: string; explanation: string } | null;
    lastProgressAt: string | null;
  }[];
  recentOutcomes: (Omit<Overview["recent_outcomes"][number], "outcome"> & {
    outcome: Fact["kind"] | Unsupported;
  })[];
};

export function adaptOverview(o: Overview): OverviewView {
  return {
    counts: {
      running: adaptTotal(o.counts.running),
      ready: adaptTotal(o.counts.ready),
      needs_you: adaptTotal(o.counts.needs_you),
      recovering: adaptTotal(o.counts.recovering),
    },
    attention: o.attention.map((a) => {
      const kind = known(a.kind, ATTENTION_KINDS);
      const action = a.action && adaptAction(a.action);
      return {
        ...a,
        kind,
        action: action && kind === "unsupported" ? { ...action, allowed: false } : action,
      };
    }),
    inMotion: o.in_motion.map((m) => ({
      project: m.project,
      running: adaptTotal(m.running),
      nextConstraint: m.next_constraint,
      lastProgressAt: m.last_progress_at,
    })),
    recentOutcomes: o.recent_outcomes.map((r) => ({ ...r, outcome: known(r.outcome, FACT_KINDS) })),
  };
}

/* ----- Sessions ----- */

const AUTHORITIES = ["central", "remote", "unknown"] as const;
const CONTROLLER_STATES = ["none", "held", "unknown"] as const;

export type SessionView = {
  id: string;
  label: string;
  task: SessionSummary["task"];
  attemptId: string | null;
  project: SessionSummary["project"];
  profile: SessionSummary["profile"];
  authority: SessionSummary["authority"] | Unsupported;
  observation: {
    state: ProcessObservation | Unsupported;
    observedAt: string;
    freshness: "fresh" | "stale";
  };
  wait: SessionSummary["wait"];
  controller: { state: SessionSummary["controller"]["state"] | Unsupported; label: string | null };
  terminal: SessionSummary["terminal"];
};

export function adaptSession(s: SessionSummary, serverTime: string): SessionView {
  return {
    id: s.id,
    label: s.label,
    task: s.task,
    attemptId: s.attempt_id,
    project: s.project,
    profile: s.profile,
    authority: known(s.authority, AUTHORITIES),
    observation: {
      state: known(s.observation.state, OBSERVATIONS),
      observedAt: s.observation.observed_at,
      freshness: isStale(serverTime, s.observation.fresh_until) ? "stale" : "fresh",
    },
    wait: s.wait,
    controller: { state: known(s.controller.state, CONTROLLER_STATES), label: s.controller.label },
    terminal: s.terminal,
  };
}

export type SessionDetailView = SessionView & {
  profileRevisions: SessionDetail["profile_revisions"];
  permissions: string[];
  lastActivityAt: string | null;
};

export function adaptSessionDetail(s: SessionDetail, serverTime: string): SessionDetailView {
  return {
    ...adaptSession(s, serverTime),
    profileRevisions: s.profile_revisions,
    permissions: s.permissions,
    lastActivityAt: s.last_activity_at,
  };
}

/* ----- Search ----- */

const SEARCH_TYPES = ["task", "session", "result", "playbook", "knowledge"] as const;

export type SearchView = {
  groups: {
    type: SearchResults["groups"][number]["type"] | Unsupported;
    hits: SearchResults["groups"][number]["hits"];
    hasMore: boolean;
  }[];
};

export function adaptSearch(data: SearchResults): SearchView {
  if (!isRecord(data) || !Array.isArray(data.groups)) throw new ContractError("search groups must be a list");
  return {
    groups: data.groups.map((g) => {
      if (!isRecord(g) || !Array.isArray(g.hits)) throw new ContractError("search hits must be a list");
      for (const h of g.hits) {
        if (!isRecord(h) || !isRecord(h.ref) || typeof h.ref.id !== "string" || typeof h.title !== "string") {
          throw new ContractError("search hit must have a ref and title");
        }
      }
      return { type: known(String(g.type), SEARCH_TYPES), hits: g.hits, hasMore: g.has_more === true };
    }),
  };
}
