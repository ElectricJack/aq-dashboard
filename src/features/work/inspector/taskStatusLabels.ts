import { nodeLabel } from "../../../api/adapters/humanGraph";
import { TASK_STATUS_LABEL, attemptEnded, unrecognizedLabel, type TaskStatus } from "../labels";
import type { StartupOverLimit, TaskAttempt, TaskBlocker, TaskWork, WorkReadiness } from "../taskWork";
import { humanize } from "./common";

/**
 * The status of the attempt holding the task when that attempt has ended (P1-01), from the work read's
 * `execution.status` or, when the history read is loaded, the same attempt's status there; null otherwise.
 */
export function endedHolder(work: TaskWork | undefined, attempts?: readonly TaskAttempt[]): string | null {
  const e = work?.execution;
  if (!e) return null;
  if (attemptEnded(e.status)) return e.status;
  const recorded = attempts?.find(a => a.attempt_id === e.attempt_id);
  return recorded && attemptEnded(recorded.status) ? recorded.status : null;
}

/**
 * Readiness from the work read, or the Graph lifecycle state while it is unknown. AQ says `held` itself since
 * aq-server #99; for an older server, "running" with an ended holder is still shown as held (the P1-01 fallback).
 */
export function headerStatus(work: TaskWork | undefined, lifecycle: string | null, ended: string | null = null): TaskStatus {
  if (work) return work.state === "running" && ended ? "held" : work.state;
  const known = ["draft", "completed", "canceled", "active"] as const;
  return known.find(state => state === lifecycle) ?? "unknown";
}
/** True when the client-side fallback, not AQ, decided the task is held (a server without `held`). */
export const heldByFallback = (work: TaskWork | undefined, ended: string | null) => work?.state === "running" && !!ended;
/** Blockers that keep the task waiting: not completed (false), or not in the read Context (null). */
export const unsatisfied = (work: TaskWork) => work.blockers.filter(b => b.satisfied !== true);
export const blockerName = (b: TaskBlocker) => b.title ?? `task ${b.id.slice(0, 8)}`;

/** A hold's short reason for the badge, by code; a code this bundle doesn't know shows its message in Status only. */
const HOLD_SHORT: Record<string, string> = {
  cancelled_attempt_holds_task: "cancelled attempt holds it",
  attempt_stopped_not_released: "stopped attempt not released",
  result_ready: "awaiting delivery",
  result_ready_no_delivery_policy: "no active delivery policy",
  attempt_finished_stop_unconfirmed: "stop not confirmed",
  role_disabled: "its role is disabled", role_missing: "its role does not exist", level_missing: "its level does not exist",
  startup_over_limit: "startup text over its limit", platform_text_missing: "no platform text for its environment",
  owner_retry_pending: "owner retry pending",
  closure_does_not_prove_nonstart: "launch not proven stopped", closed_launch_settlement_pending: "closed launch settling",
  stopped_result_recovery_pending: "stopped result recovering", launch_retry_backoff: "launch retry backing off",
};
const count = (n: number) => n.toLocaleString("en-US");
/** "70,112 of 65,536 bytes": the startup text's size and the limit it is over. */
export const startupNumbers = (s: StartupOverLimit) => `${count(s.bytes)} of ${count(s.limit)} bytes`;
/** Which limit that is: the execution profile's, or the project's ceiling. */
export const startupLimit = (s: StartupOverLimit) => s.limiting === "project_context_bytes" ? "the project's context_bytes ceiling" : `startup_context_bytes of execution profile ${s.execution_profile}`;

/** The badge's short reason (spec 0004 item 2): only what the server said, most specific first. */
export function statusReason(state: WorkReadiness | undefined, work: TaskWork | undefined): string | null {
  if (!work || !state) return null;
  if (state === "waiting") return waitingReason(work);
  if (state === "held") return heldReason(work);
  if (state === "unknown") return "relationships not fully read";
  return null;
}


function waitingReason(work: TaskWork) {
  const open = unsatisfied(work);
  return open.length === 1 ? `blocked by “${blockerName(open[0]!)}”` : open.length ? `blocked by ${open.length} tasks` : null;
}

export function holdEvidence(work: TaskWork) {
  const holder = work.execution?.attempt_id;
  const recorded = work.reasons.find(reason => reason.result_id && reason.attempt_id === holder);
  const reasons = recorded
    ? work.reasons.filter(reason => reason.code !== "attempt_stopped_not_released" || reason.attempt_id !== holder)
    : work.reasons;
  const attemptHeld = !work.reasons.length || work.reasons.some(reason => reason.attempt_id);
  return { holder, recorded, reasons, explainClaim: work.state === "held" && !recorded && attemptHeld };
}

function heldReason(work: TaskWork) {
  const first = work.reasons.find(r => r.code === "task_held")
    ?? holdEvidence(work).recorded
    ?? work.reasons[0];
  if (first?.hold_reason) return humanize(first.hold_reason).toLowerCase();
  const short = HOLD_SHORT[first?.code ?? ""] ?? null;
  return short && first?.startup ? `${short} (${startupNumbers(first.startup)})` : short;
}

export function badgeText(work: TaskWork | undefined, lifecycle: string | null, ended: string | null) {
  const status = headerStatus(work, lifecycle, ended);
  const result = (label: string, title?: string) => ({ status, label, title });
  if (heldByFallback(work, ended)) return { status,
    label: `Held by a ${humanize(ended!).toLowerCase()} attempt`,
    title: "AQ reports this task as running, but the attempt holding it has ended.",
  };
  if (!work) return result(nodeLabel(lifecycle));
  if (status === "unrecognized") return { status,
    label: unrecognizedLabel(work.reported),
    title: "AQ reported a readiness state this dashboard version doesn't know.",
  };
  const label = status === "completed" && work.noChanges ? "Completed, no changes" : TASK_STATUS_LABEL[status];
  const title = status === "held" ? work.reasons.map(reason => reason.message).join("\n") || undefined : undefined;
  return result(label, title);
}
