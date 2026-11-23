import { ContractError, isRecord } from "./contract";

/** H4 owner wait inspection (`GET /api/waits`, `GET /api/waits/{id}`), bare JSON. */
export type WaitRow = { id: string; taskId: string; attemptId: string; phase: string; revision: number; deadline: string | null; nextDue: string | null; created: string; outcomeKind: string | null; intentState: string | null };
export type WaitRef = { id: string; version: string; digest: string };
export type WaitMember = { id: string; condition: string; kind: string; state: string; evidence: string | null; unavailableReason: string | null; lastChecked: string | null; lastVerified: string | null };
export type WaitDetail = {
  id: string; generation: string; continuationGeneration: string; predicate: string; phase: string; revision: number;
  deadline: string | null; nextDue: string | null; members: WaitMember[];
  lifecycle: string; compute: string; disk: string; continuation: string; blocker: string | null;
  outcome: { kind: string; label: string; override: boolean; recordedAt: string } | null; intentState: string | null;
};

function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid wait inspection response"); }
const str = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const nat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const ms = (v: unknown): string | null => { if (v == null || v === 0) return null; ensure(nat(v) && v <= 8640000000000000); return new Date(v).toISOString(); };
const gen = (v: unknown) => { ensure(nat(v) || (typeof v === "string" && /^[0-9]{1,20}$/.test(v))); return String(v); };
const short = (id: string) => id.slice(0, 8);
const artifact = (v: unknown): WaitRef => { ensure(isRecord(v) && str(v.id) && (str(v.version) || nat(v.version)) && str(v.digest)); return { id: v.id, version: String(v.version), digest: v.digest }; };
export const refText = (r: WaitRef) => `${r.id} · revision ${r.version}`;

const PHASES = ["installing", "pending", "recovery_held", "terminal"];
export function adaptWaitList(raw: unknown, attemptId: string | null): WaitRow[] {
  ensure(isRecord(raw));
  ensure(Array.isArray(raw.items) && raw.items.length <= 500);
  return raw.items.map((r): WaitRow => {
    ensure(isRecord(r));
    ensure(str(r.wait_id));
    ensure(str(r.task_id));
    ensure(str(r.attempt_id));
    ensure(PHASES.includes(String(r.phase)));
    ensure(nat(r.revision));
    ensure(r.outcome_kind == null || str(r.outcome_kind, 64));
    ensure(r.intent_state == null || str(r.intent_state, 64));
    return { id: r.wait_id, taskId: r.task_id, attemptId: r.attempt_id, phase: String(r.phase), revision: r.revision, deadline: ms(r.deadline_ms), nextDue: ms(r.next_due_ms),
      created: ms(r.created_at_ms) ?? "", outcomeKind: (r.outcome_kind as string | null | undefined) ?? null, intentState: (r.intent_state as string | null | undefined) ?? null };
  }).filter(row => !attemptId || row.attemptId === attemptId);
}

const REQUIREMENT: Record<string, string> = { successful: "requires producer success", settled: "requires producer settlement" };
type DescribeCondition = (condition: Record<string, unknown>) => string;
const conditionDescriptions = new Map<string, DescribeCondition>([
  ["task", c => `Producer task ${short(String(c.task_id))} at revision ${String(c.revision)} · ${REQUIREMENT[String(c.requirement)] ?? "requirement unknown"}`],
  ["dependency", c => `Dependency edge ${short(String(c.edge_id))} (revision ${String(c.edge_revision)}) on task ${short(String(c.depends_on_task_id))} · resolves the edge, not the producer's success`],
  ["message", c => `Message on thread ${short(String(c.thread_id))} after cursor ${String(c.exclusive_cursor)}`],
  ["human_decision", c => `Human decision ${short(String(c.decision_id))} on subject revision ${String(c.subject_revision)}`],
  ["timer", c => `Timer due ${ms(c.due_at_ms) ?? "unknown"}`],
  ["operation", c => `Operation ${short(String(c.operation_id))} at revision ${String(c.revision)}`],
  ["playbook_run", c => `Playbook run ${short(String(c.run_id))} at revision ${String(c.revision)}`],
  ["wait_outcome", () => "Outcome of another wait"],
  ["resource", c => `Resource ${String(c.resource)}`],
]);

function condition(c: unknown): { kind: string; text: string } {
  ensure(isRecord(c));
  ensure(str(c.kind, 64));
  const describe = conditionDescriptions.get(c.kind);
  return describe ? { kind: c.kind, text: describe(c) } : { kind: "unsupported", text: "Unsupported condition" };
}
const MEMBER_STATE: Record<string, string> = { pending: "Pending", satisfied: "Satisfied", source_failed: "Source failed", source_unavailable: "Source unavailable" };
export const OUTCOME_LABEL: Record<string, string> = { satisfied: "Satisfied", source_failed: "Source failed", cancelled: "Wait cancelled", deadline_reached: "Deadline reached", source_unavailable: "Source unavailable", manual_override: "Manual early resume (override)" };

const CONTINUATION_LABEL = new Map([["bootstrap_acknowledged", "Running"], ["wake_admitted", "Resume pending"], ["cancelled", "Continuation cancelled"]]);
const EXECUTION_LABEL = new Map([["warm_bounded", "Warm waiting"], ["suspension_requested", "Suspension requested"], ["policy_pending", "Wait policy pending"]]);

function lifecycle(execution: Record<string, unknown>, continuation: Record<string, unknown>, parking: WaitRef | null) {
  const c = String(continuation.kind), e = String(execution.kind);
  const parked = e === "parked_reported";
  const receipt = parked ? artifact(execution.receipt) : null;
  const executionLabel = parked ? (parking ? "Retained hibernation" : "Parked") : EXECUTION_LABEL.get(e);
  const label = CONTINUATION_LABEL.get(c) ?? executionLabel ?? "Unsupported execution state";
  const compute = parked ? `Compute released · parking receipt ${refText(receipt!)}` : e === "warm_bounded" ? `Compute held warm until ${ms(execution.expires_at_ms) ?? "unknown"}` : "Compute release not reported";
  const disk = parking ? `Disk protected · parking report ${refText(parking)}` : "Disk protection not reported";
  return { label, compute, disk };
}
const CONTINUATION: Record<string, string> = { pending_policy: "Continuation pending policy", held: "Continuation held", wake_admitted: "Wake admitted", bootstrap_acknowledged: "Successor bootstrap acknowledged", cancelled: "Continuation cancelled" };

function memberState(id: string, latest: Record<string, unknown>, outcomes: unknown[]) {
  const state = isRecord(latest.state) ? latest.state : outcomes.find(outcome => isRecord(outcome) && outcome.member_id === id);
  if (!state) return { state: "Not yet observed", evidence: null };
  ensure(isRecord(state));
  ensure(state.member_id === id);
  const evidence = isRecord(state.evidence) ? state.evidence : null;
  return {
    state: MEMBER_STATE[String(state.state)] ?? "Unsupported state",
    evidence: evidence ? `Verified result ${refText(artifact(evidence.result))} · source revision ${String(evidence.revision)}` : null,
  };
}

function waitMember(member: unknown, latest: unknown, outcomes: unknown[]): WaitMember {
  ensure(isRecord(member));
  ensure(str(member.member_id));
  const observation = isRecord(latest) ? latest : {};
  const state = memberState(member.member_id, observation, outcomes);
  const description = condition(member.condition);
  return {
    id: member.member_id, condition: description.text, kind: description.kind, ...state,
    unavailableReason: str(observation.unavailable_reason, 512) ? observation.unavailable_reason : null,
    lastChecked: ms(observation.last_checked_at_ms), lastVerified: ms(observation.last_verified_at_ms),
  };
}

function predicateMembers(predicate: Record<string, unknown>) {
  const members = predicate.kind === "single" ? [predicate.member] : predicate.members;
  ensure(Array.isArray(members));
  ensure(members.length > 0 && members.length <= 64);
  ensure(["single", "all", "any"].includes(String(predicate.kind)));
  const label = predicate.kind === "single" ? "Single condition"
    : predicate.kind === "all" ? `All of ${members.length} conditions` : `Any of ${members.length} conditions`;
  return { members, label };
}

function outcomeDisplay(outcome: Record<string, unknown> | null) {
  if (!outcome) return null;
  return { kind: String(outcome.kind), label: OUTCOME_LABEL[String(outcome.kind)] ?? "Unsupported outcome",
    override: outcome.kind === "manual_override", recordedAt: ms(outcome.recorded_at_ms) ?? "" };
}

function holdReason(continuation: Record<string, unknown>, fallback: unknown) {
  if (continuation.kind === "held" && str(continuation.reason, 512)) return continuation.reason;
  return str(fallback, 512) ? fallback : null;
}

export function adaptWaitDetail(raw: unknown, id: string): WaitDetail {
  ensure(isRecord(raw));
  ensure(isRecord(raw.view));
  ensure(JSON.stringify(raw).length <= 262144);
  const view = raw.view, reg = view.registration;
  ensure(isRecord(reg));
  ensure(isRecord(reg.wait) && reg.wait.wait_id === id);
  ensure(isRecord(reg.predicate));
  ensure(isRecord(reg.continuation));
  ensure(isRecord(reg.execution));
  ensure(isRecord(view.continuation));
  const p = reg.predicate;
  const { members, label } = predicateMembers(p);
  const fresh = Array.isArray(raw.members) ? raw.members : [];
  const parking = view.parking_report ? artifact(view.parking_report) : null;
  const out = isRecord(view.outcome) ? view.outcome : null;
  const outcomeMembers = out && Array.isArray(out.members) ? out.members : [];
  const rows = members.map((m, i) => waitMember(m, fresh[i], outcomeMembers));
  const cont = view.continuation, life = lifecycle(reg.execution, cont, parking);
  const blocker = holdReason(cont, raw.hold_reason);
  ensure(nat(raw.revision));
  ensure(PHASES.includes(String(raw.phase)));
  return {
    id, generation: gen(reg.wait.generation), continuationGeneration: gen(reg.continuation.generation),
    predicate: label,
    phase: String(raw.phase), revision: raw.revision, deadline: ms(raw.deadline_ms), nextDue: ms(raw.next_due_ms), members: rows,
    lifecycle: life.label, compute: life.compute, disk: life.disk, continuation: CONTINUATION[String(cont.kind)] ?? "Unsupported continuation state", blocker,
    outcome: outcomeDisplay(out),
    intentState: str(raw.intent_state, 64) ? raw.intent_state : null,
  };
}
