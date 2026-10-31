/**
 * PROPOSED wire types transcribed from docs/specs/0003-dashboard-api.md.
 * API-02 has not published these schemas; replace this file with generated
 * bindings once it does. Nothing here describes a live AQ route.
 */

export type Id = string;
/** Positive decimal string. Never convert to Number. */
export type Revision = string;
/** UTC RFC3339 with milliseconds. */
export type Timestamp = string;
export type Digest = string;

export type Scope = { kind: "all_authorized" } | { kind: "project"; project_id: Id };

export type Observation = {
  observed_at: Timestamp;
  fresh_until: Timestamp;
  source: string;
  quality: "reported" | "estimated" | "unknown";
  coverage: "complete" | "partial" | "unknown";
};

export type Coverage = {
  state: "complete" | "partial" | "unknown";
  omitted_count?: number;
  reason?: string;
};

export type Envelope<T> = {
  api_version: string;
  request_id: string;
  server_time: Timestamp;
  scope: Scope;
  data: T;
  observation: Observation;
  pending_operations: Id[];
  coverage: Coverage;
};

export type ErrorEnvelope = {
  request_id: string;
  code: string;
  message: string;
  retryable: boolean;
  operation_id?: Id;
  field_errors?: { field: string; message: string }[];
  current_versions?: Record<string, Revision>;
  retry_after_ms?: number;
};

export type Capability = { name: string; version: string; enabled: boolean; reason?: string };

export type Bootstrap = {
  principal: { id: Id; display_name: string; authorization_revision: Revision };
  product: { version: string; dashboard_digest: Digest };
  contracts: { name: string; version: string; digest: Digest }[];
  capabilities: Capability[];
  limits: { page_size: number };
  default_scope: Scope;
  global_supervisor: {
    status: "available" | "unconfigured" | "unavailable";
    conversation_id: Id | null;
    reason?: string;
  };
};

export type QuotaWindow = {
  id: Id;
  label: string;
  starts_at: Timestamp | null;
  resets_at: Timestamp | null;
  used_percent: number | null;
  used: number | null;
  limit: number | null;
  unit: string | null;
  state: "known" | "unknown" | "unavailable";
  observation: Observation;
};

export type ProviderUsage = {
  provider_id: Id;
  account_ref: Id;
  account_label: string;
  scope: "provider_account";
  windows: QuotaWindow[];
  preferred_window_id: Id | null;
  availability_ref: { type: string; id: Id; revision?: Revision } | null;
};

/* ---------------------------------------------------------------------------
 * D04 read models. docs/specs/0003-dashboard-api.md §4 names these
 * projections but not their fields; the shapes below are DASHBOARD-PROPOSED
 * input for API-02 review. Vocabulary follows existing components:
 * task state and edge types from aq-graph's OpenAPI, process observation
 * from agent-q's lifecycle API.
 * ------------------------------------------------------------------------- */

export type EntityRef = { type: string; id: Id; revision?: Revision };
export type TitledRef = EntityRef & { title: string };
export type ProjectRef = { id: Id; label: string };

export type Total = { value: number | null; accuracy: "exact" | "estimated" | "unknown" };

export type Page<T> = {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  snapshot_id: string;
  total: Total;
};

export type ActionDescriptor = {
  kind: string;
  subject: EntityRef;
  allowed: boolean;
  reason_code?: string;
  explanation?: string;
  expected_versions: Record<string, Revision>;
  expires_at?: Timestamp;
};

/** aq-graph TaskState. */
export type TaskState = "draft" | "active" | "completed" | "canceled";
/** agent-q lifecycle ProcessObservation. */
export type ProcessObservation = "unknown" | "reported_running" | "reported_stopped";
/** Server-derived readiness; the browser never computes it from the graph. */
export type ReadinessState =
  | "draft"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "needs_decision"
  | "failed"
  | "done"
  | "canceled";

export type Readiness = { state: ReadinessState; explanation: string };

export type TaskSummary = {
  id: Id;
  revision: Revision;
  title: string;
  project: ProjectRef;
  state: TaskState;
  readiness: Readiness;
  execution: {
    observation: ProcessObservation;
    observed_at: Timestamp | null;
    session_id: Id | null;
    agent_label: string | null;
  };
  blocker: { kind: string; explanation: string } | null;
  latest_result: { id: Id; revision: Revision; summary: string; submitted_at: Timestamp } | null;
  updated_at: Timestamp;
};

export type FactKind =
  | "source_retained"
  | "result_submitted"
  | "result_accepted"
  | "task_completed"
  | "candidate_published"
  | "merged"
  | "deployed";

export type Fact = {
  kind: FactKind;
  state: "confirmed" | "not_yet" | "unknown";
  at: Timestamp | null;
  receipt: EntityRef | null;
};

export type Attempt = {
  id: Id;
  number: number;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  outcome: "running" | "succeeded" | "failed" | "canceled" | "unknown";
  session_id: Id | null;
};

export type TaskDetail = TaskSummary & {
  description: string;
  acceptance: { revision: Revision; criteria: string[] };
  dependencies: { task: TitledRef; satisfied: boolean | null; explanation: string }[];
  attempts: Attempt[];
  facts: Fact[];
  actions: ActionDescriptor[];
};

/** aq-graph EdgeType. */
export type EdgeType =
  | "blocks"
  | "parent-child"
  | "references"
  | "motivated_by"
  | "produces"
  | "supports"
  | "contradicts"
  | "supersedes";

export type TaskGraph = {
  root_id: Id;
  nodes: { id: Id; revision: Revision; title: string; state: TaskState; readiness: Readiness }[];
  edges: { from: Id; to: Id; type: EdgeType }[];
  omitted: { nodes: number; edges: number; reason?: string };
};

export type AttentionItem = {
  id: Id;
  kind: "decision" | "blocked" | "failed" | "uncertain_operation";
  title: string;
  project: ProjectRef;
  reason: string;
  impact: string;
  since: Timestamp;
  subject: EntityRef;
  action: ActionDescriptor | null;
};

export type Overview = {
  counts: { running: Total; ready: Total; needs_you: Total; recovering: Total };
  attention: AttentionItem[];
  in_motion: {
    project: ProjectRef;
    running: Total;
    next_constraint: { kind: string; explanation: string } | null;
    last_progress_at: Timestamp | null;
  }[];
  recent_outcomes: { subject: TitledRef; project: ProjectRef; outcome: FactKind; at: Timestamp }[];
};

export type SessionSummary = {
  id: Id;
  label: string;
  task: TitledRef | null;
  attempt_id: Id | null;
  project: ProjectRef;
  profile: { provider: string | null; model: string | null; harness: string | null };
  authority: "central" | "remote" | "unknown";
  observation: { state: ProcessObservation; observed_at: Timestamp; fresh_until: Timestamp };
  wait: { id: Id; explanation: string } | null;
  controller: { state: "none" | "held" | "unknown"; label: string | null };
  terminal: EntityRef | null;
};

export type SessionDetail = SessionSummary & {
  profile_revisions: { name: string; revision: Revision }[];
  permissions: string[];
  last_activity_at: Timestamp | null;
};

export type SearchHit = { ref: EntityRef; title: string; excerpt: string; project: ProjectRef | null };
export type SearchResults = {
  groups: {
    type: "task" | "session" | "result" | "playbook" | "knowledge";
    hits: SearchHit[];
    has_more: boolean;
  }[];
};
