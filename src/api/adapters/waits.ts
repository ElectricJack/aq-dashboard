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
const ms = (v: unknown): string | null => { if (v === null || v === undefined || v === 0) return null; ensure(nat(v) && v <= 8640000000000000); return new Date(v).toISOString(); };
const gen = (v: unknown) => { ensure(nat(v) || (typeof v === "string" && /^[0-9]{1,20}$/.test(v))); return String(v); };
const short = (id: string) => id.slice(0, 8);
const artifact = (v: unknown): WaitRef => { ensure(isRecord(v) && str(v.id) && (str(v.version) || nat(v.version)) && str(v.digest)); return { id: v.id, version: String(v.version), digest: v.digest }; };
export const refText = (r: WaitRef) => `${r.id} · revision ${r.version}`;

const PHASES = ["installing", "pending", "recovery_held", "terminal"];
export function adaptWaitList(raw: unknown, attemptId: string | null): WaitRow[] {
  ensure(isRecord(raw) && Array.isArray(raw.items) && raw.items.length <= 500);
  return raw.items.map((r): WaitRow => {
    ensure(isRecord(r) && str(r.wait_id) && str(r.task_id) && str(r.attempt_id) && PHASES.includes(String(r.phase)) && nat(r.revision));
    ensure((r.outcome_kind === null || r.outcome_kind === undefined || str(r.outcome_kind, 64)) && (r.intent_state === null || r.intent_state === undefined || str(r.intent_state, 64)));
    return { id: r.wait_id, taskId: r.task_id, attemptId: r.attempt_id, phase: String(r.phase), revision: r.revision, deadline: ms(r.deadline_ms), nextDue: ms(r.next_due_ms),
      created: ms(r.created_at_ms) ?? "", outcomeKind: (r.outcome_kind as string | null | undefined) ?? null, intentState: (r.intent_state as string | null | undefined) ?? null };
  }).filter(row => !attemptId || row.attemptId === attemptId);
}

const REQUIREMENT: Record<string, string> = { successful: "requires producer success", settled: "requires producer settlement" };
function condition(c: unknown): { kind: string; text: string } {
  ensure(isRecord(c) && str(c.kind, 64));
  const req = REQUIREMENT[String(c.requirement)] ?? "requirement unknown";
  switch (c.kind) {
    case "task": return { kind: "task", text: `Producer task ${short(String(c.task_id))} at revision ${String(c.revision)} · ${req}` };
    case "dependency": return { kind: "dependency", text: `Dependency edge ${short(String(c.edge_id))} (revision ${String(c.edge_revision)}) on task ${short(String(c.depends_on_task_id))} · resolves the edge, not the producer's success` };
    case "message": return { kind: "message", text: `Message on thread ${short(String(c.thread_id))} after cursor ${String(c.exclusive_cursor)}` };
    case "human_decision": return { kind: "human_decision", text: `Human decision ${short(String(c.decision_id))} on subject revision ${String(c.subject_revision)}` };
    case "timer": return { kind: "timer", text: `Timer due ${ms(c.due_at_ms) ?? "unknown"}` };
    case "operation": return { kind: "operation", text: `Operation ${short(String(c.operation_id))} at revision ${String(c.revision)}` };
    case "playbook_run": return { kind: "playbook_run", text: `Playbook run ${short(String(c.run_id))} at revision ${String(c.revision)}` };
    case "wait_outcome": return { kind: "wait_outcome", text: "Outcome of another wait" };
    case "resource": return { kind: "resource", text: `Resource ${String(c.resource)}` };
    default: return { kind: "unsupported", text: "Unsupported condition" };
  }
}
const MEMBER_STATE: Record<string, string> = { pending: "Pending", satisfied: "Satisfied", source_failed: "Source failed", source_unavailable: "Source unavailable" };
export const OUTCOME_LABEL: Record<string, string> = { satisfied: "Satisfied", source_failed: "Source failed", cancelled: "Wait cancelled", deadline_reached: "Deadline reached", source_unavailable: "Source unavailable", manual_override: "Manual early resume (override)" };

function lifecycle(execution: Record<string, unknown>, continuation: Record<string, unknown>, parking: WaitRef | null) {
  const c = String(continuation.kind), e = String(execution.kind);
  const parked = e === "parked_reported";
  const receipt = parked ? artifact(execution.receipt) : null;
  const label = c === "bootstrap_acknowledged" ? "Running" : c === "wake_admitted" ? "Resume pending" : c === "cancelled" ? "Continuation cancelled"
    : parked ? (parking ? "Retained hibernation" : "Parked") : e === "warm_bounded" ? "Warm waiting" : e === "suspension_requested" ? "Suspension requested" : e === "policy_pending" ? "Wait policy pending" : "Unsupported execution state";
  const compute = parked ? `Compute released · parking receipt ${refText(receipt!)}` : e === "warm_bounded" ? `Compute held warm until ${ms(execution.expires_at_ms) ?? "unknown"}` : "Compute release not reported";
  const disk = parking ? `Disk protected · parking report ${refText(parking)}` : "Disk protection not reported";
  return { label, compute, disk };
}
const CONTINUATION: Record<string, string> = { pending_policy: "Continuation pending policy", held: "Continuation held", wake_admitted: "Wake admitted", bootstrap_acknowledged: "Successor bootstrap acknowledged", cancelled: "Continuation cancelled" };

export function adaptWaitDetail(raw: unknown, id: string): WaitDetail {
  ensure(isRecord(raw) && isRecord(raw.view) && JSON.stringify(raw).length <= 262144);
  const view = raw.view, reg = view.registration;
  ensure(isRecord(reg) && isRecord(reg.wait) && reg.wait.wait_id === id && isRecord(reg.predicate) && isRecord(reg.continuation) && isRecord(reg.execution) && isRecord(view.continuation));
  const p = reg.predicate;
  const members = p.kind === "single" ? [p.member] : Array.isArray(p.members) ? p.members : null;
  ensure(members && members.length > 0 && members.length <= 64 && ["single", "all", "any"].includes(String(p.kind)));
  const fresh = Array.isArray(raw.members) ? raw.members : [];
  const parking = view.parking_report ? artifact(view.parking_report) : null;
  const out = isRecord(view.outcome) ? view.outcome : null;
  const outcomeMembers = out && Array.isArray(out.members) ? out.members : [];
  const rows = members.map((m: unknown, i: number): WaitMember => {
    ensure(isRecord(m) && str(m.member_id));
    const f = fresh[i]; const state = isRecord(f) && isRecord(f.state) ? f.state : outcomeMembers.find((o: unknown) => isRecord(o) && o.member_id === m.member_id);
    ensure(!state || (isRecord(state) && state.member_id === m.member_id));
    const evidence = isRecord(state) && isRecord(state.evidence) ? state.evidence : null;
    const c = condition(m.condition);
    return { id: m.member_id, condition: c.text, kind: c.kind, state: isRecord(state) ? MEMBER_STATE[String(state.state)] ?? "Unsupported state" : "Not yet observed",
      evidence: evidence ? `Verified result ${refText(artifact(evidence.result))} · source revision ${String(evidence.revision)}` : null,
      unavailableReason: isRecord(f) && str(f.unavailable_reason, 512) ? f.unavailable_reason : null,
      lastChecked: isRecord(f) ? ms(f.last_checked_at_ms) : null, lastVerified: isRecord(f) ? ms(f.last_verified_at_ms) : null };
  });
  const cont = view.continuation, life = lifecycle(reg.execution, cont, parking);
  const blocker = cont.kind === "held" && str(cont.reason, 512) ? cont.reason : str(raw.hold_reason, 512) ? raw.hold_reason : null;
  ensure(nat(raw.revision) && PHASES.includes(String(raw.phase)));
  return {
    id, generation: gen(reg.wait.generation), continuationGeneration: gen(reg.continuation.generation),
    predicate: p.kind === "single" ? "Single condition" : p.kind === "all" ? `All of ${members.length} conditions` : `Any of ${members.length} conditions`,
    phase: String(raw.phase), revision: raw.revision, deadline: ms(raw.deadline_ms), nextDue: ms(raw.next_due_ms), members: rows,
    lifecycle: life.label, compute: life.compute, disk: life.disk, continuation: CONTINUATION[String(cont.kind)] ?? "Unsupported continuation state", blocker,
    outcome: out ? { kind: String(out.kind), label: OUTCOME_LABEL[String(out.kind)] ?? "Unsupported outcome", override: out.kind === "manual_override", recordedAt: ms(out.recorded_at_ms) ?? "" } : null,
    intentState: str(raw.intent_state, 64) ? raw.intent_state : null,
  };
}
