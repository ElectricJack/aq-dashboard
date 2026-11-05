/** Labelled H4 owner wait-inspection fixtures (aq-server `GET /api/waits`, `GET /api/waits/{id}`). */
export const waitId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const WAIT_MS = 1793534400000;
export function waitRow(n: number, attemptId: string, phase = "pending") {
  return { wait_id: waitId(n), project_id: waitId(90), workspace_id: waitId(91), task_id: waitId(80), attempt_id: attemptId, phase, revision: 3,
    next_due_ms: WAIT_MS + 60_000, deadline_ms: WAIT_MS + 3_600_000, created_at_ms: WAIT_MS - 600_000, outcome_kind: null, intent_state: null };
}
const ref = (n: number, version = 1) => ({ id: waitId(n), version, digest: `sha256:${"a".repeat(64)}` });
export function waitDetail(n: number, options: { parked?: boolean; continuation?: Record<string, unknown>; outcome?: string | null; holdReason?: string | null } = {}) {
  const dependency = { member_id: "dep", condition: { kind: "dependency", edge_id: waitId(40), edge_revision: 2, from_task_id: waitId(80), depends_on_task_id: waitId(81), requirement: "settled" } };
  const producer = { member_id: "producer", condition: { kind: "task", task_id: waitId(82), revision: 5, requirement: "successful" } };
  const parked = options.parked ?? true;
  return {
    view: {
      registration: { wait: { wait_id: waitId(n), generation: 4, predicate_digest: `sha256:${"b".repeat(64)}` }, predicate: { kind: "all", members: [dependency, producer] },
        continuation: { continuation_id: waitId(30), generation: 6, wait: { wait_id: waitId(n), generation: 4 } }, original_created_at_ms: WAIT_MS - 600_000,
        execution: parked ? { kind: "parked_reported", receipt: ref(10, 2) } : { kind: "warm_bounded", expires_at_ms: WAIT_MS + 300_000 } },
      outcome: options.outcome ? { outcome: ref(12), kind: options.outcome, members: [], recorded_at_ms: WAIT_MS } : null,
      continuation: options.continuation ?? { kind: "pending_policy" },
      parking_report: parked ? ref(11, 3) : null,
    },
    phase: options.outcome ? "terminal" : "pending", revision: 3, deadline_ms: WAIT_MS + 3_600_000, next_due_ms: WAIT_MS + 60_000, hold_reason: options.holdReason ?? null,
    members: [
      { state: { member_id: "dep", state: "satisfied", evidence: { owner: "graph", condition_digest: `sha256:${"c".repeat(64)}`, revision: 2, result: ref(20, 7) } }, unavailable_reason: null, last_checked_at_ms: WAIT_MS - 5_000, last_verified_at_ms: WAIT_MS - 5_000 },
      { state: { member_id: "producer", state: "pending", evidence: null }, unavailable_reason: null, last_checked_at_ms: WAIT_MS - 5_000, last_verified_at_ms: null },
    ],
    intent_state: null,
  };
}
