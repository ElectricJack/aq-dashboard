import type {
  ActionDescriptor,
  EdgeType,
  Fact,
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
import { reference } from "./reference";
import { adaptSources } from "./overview";
import { adaptSessionUsageAnchor } from "./sessionUsage";

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

export { adaptOverview, type AttentionView, type OverviewView } from "./overview";

/* ----- Sessions ----- */

const AUTHORITIES = ["central", "remote", "unknown"] as const;
const CONTROLLER_STATES = ["none", "held", "unknown"] as const;

const EXECUTION_AUTHORITIES = ["offered", "preparing", "granted", "cancelling", "never_granted", "declined", "finished", "unknown"] as const;
type ExecutionAuthority = typeof EXECUTION_AUTHORITIES[number];
function lifecycle(value: unknown): { startedAt: string | null; stoppedAt: string | null } | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new ContractError("session lifecycle must be an object");
  const time = (key: string): string | null => {
    const v = value[key];
    if (v === null) return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) {
      throw new ContractError(`session lifecycle ${key} must be a timestamp or null`);
    }
    return v;
  };
  const startedAt = time("started_at");
  const stoppedAt = time("stopped_at");
  if (stoppedAt && !startedAt) throw new ContractError("stopped lifecycle requires its start report");
  return { startedAt, stoppedAt };
}
function executionAuthority(value: unknown): ExecutionAuthority | Unsupported | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new ContractError("session execution authority must be a string");
  return known(value, EXECUTION_AUTHORITIES);
}

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
  lifecycle: ReturnType<typeof lifecycle>;
  executionAuthority: ExecutionAuthority | Unsupported | null;
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
    lifecycle: lifecycle(s.lifecycle),
    executionAuthority: executionAuthority(s.execution_authority),
  };
}

export type SessionDetailView = SessionView & {
  observationBinding: ReturnType<typeof adaptSessionUsageAnchor>;
  profileRevisions: SessionDetail["profile_revisions"];
  permissions: string[];
  lastActivityAt: string | null;
};

export function adaptSessionDetail(s: SessionDetail, serverTime: string): SessionDetailView {
  return {
    ...adaptSession(s, serverTime),
    observationBinding: adaptSessionUsageAnchor(s),
    profileRevisions: s.profile_revisions,
    permissions: s.permissions,
    lastActivityAt: s.last_activity_at,
  };
}

/* ----- Search ----- */

const SEARCH_TYPES = ["task", "session", "result", "playbook", "knowledge"] as const;

export type SearchView = {
  snapshotId: string | null;
  sources: import('../wire/overview').SourceObservation[];
  groups: {
    type: string;
    hits: { ref: import('../wire/proposed').EntityRef; title:string; excerpt?:string; project?:{id:string;label:string} }[];
    hasMore: boolean;
    nextCursor: string | null;
  }[];
};

export function adaptSearch(data: unknown): SearchView {
  if (!isRecord(data) || !Array.isArray(data.groups)) throw new ContractError("search groups must be a list");
  return {
    snapshotId: typeof data.snapshot_id==='string'?data.snapshot_id:null,
    sources: adaptSources(data.sources),
    groups: data.groups.map((g) => {
      if (!isRecord(g) || !Array.isArray(g.hits) || typeof g.type!=='string' || typeof g.has_more!=='boolean' ||
          (g.next_cursor!=null && typeof g.next_cursor!=='string') || (g.next_cursor!=null && !g.has_more)) throw new ContractError("Invalid search group");
      const hits = g.hits.map((h:unknown)=>{
        if (!isRecord(h) || !isRecord(h.ref) || typeof h.title!=="string") throw new ContractError("search hit must have a ref and title");
        const ref=reference({...h.ref,type:h.ref.kind??h.ref.type});
        if(h.ref.kind && (ref.type!==g.type || !ref.revision))throw new ContractError('Invalid search reference binding');
        let project: {id:string;label:string} | undefined;
        if(h.project!=null){
          if(!isRecord(h.project)||typeof h.project.id!=='string'||typeof h.project.label!=='string')throw new ContractError('Invalid search project');
          project={id:h.project.id,label:h.project.label};
        }
        return {ref,title:h.title,excerpt:typeof h.excerpt==='string'?h.excerpt:undefined,project};
      });
      return { type: known(g.type, SEARCH_TYPES), hits, hasMore: g.has_more, nextCursor: g.next_cursor??null };
    }),
  };
}
