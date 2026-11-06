import type { ReadinessView, TaskDetailView } from "../../api/adapters/inspection";

export const READINESS_LABEL: Record<ReadinessView["state"], string> = {
  draft: "Draft",
  ready: "Ready",
  running: "Running",
  waiting: "Waiting",
  blocked: "Blocked",
  needs_decision: "Needs decision",
  failed: "Failed",
  done: "Complete",
  canceled: "Canceled",
  unsupported: "Unsupported state",
};

/** Filter options, in workflow order. */
export const READINESS_FILTERS = [
  "needs_decision",
  "failed",
  "blocked",
  "waiting",
  "ready",
  "running",
  "done",
  "draft",
  "canceled",
] as const;

export const FACT_STATE_LABEL: Record<TaskDetailView["facts"][number]["state"], string> = {
  confirmed: "Confirmed",
  not_yet: "Not yet",
  unknown: "Unknown",
  unsupported: "Unsupported",
};

export const ATTEMPT_LABEL: Record<TaskDetailView["attempts"][number]["outcome"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
  unknown: "Outcome unknown",
  unsupported: "Unsupported outcome",
};

/** Lifecycle chips on the Work toolbar, in workflow order. Selection lives in `?state=`. */
export const WORK_STATE_FILTERS = ["draft", "active", "completed", "canceled"] as const;
export type WorkStateFilter = (typeof WORK_STATE_FILTERS)[number];
export const WORK_STATE_LABEL: Record<WorkStateFilter, string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  canceled: "Canceled",
};
export const workStateFilter = (value: string | null): WorkStateFilter | undefined =>
  (WORK_STATE_FILTERS as readonly string[]).includes(value ?? "") ? (value as WorkStateFilter) : undefined;

/**
 * One task status for the list bullet and the inspector badge (spec 0004 items 2, 16). The list knows only the
 * Graph lifecycle plus "running" from the page's `executions`, so an active task there is "active", not "ready";
 * the inspector's work read gives the readiness states.
 */
export type TaskStatus = "draft" | "active" | "ready" | "running" | "held" | "waiting" | "unknown" | "unrecognized" | "completed" | "canceled";
/** `unrecognized` is a readiness value from a newer server; the badge shows it as "Unknown (value)" (W77). */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "Draft", active: "Active", ready: "Ready", running: "Running", held: "Held", waiting: "Waiting",
  unknown: "Readiness unknown", unrecognized: "Unknown state", completed: READINESS_LABEL.done, canceled: READINESS_LABEL.canceled,
};
/** "Unknown (value)": a neutral label for an open-enum value this bundle doesn't know (W77). */
export const unrecognizedLabel = (value: string) => `Unknown (${value})`;
/**
 * Attempt statuses after which no agent works on the task (aq-server execution authority: `finished`, `declined`,
 * `never_granted`; the fixture outcomes too). An attempt in one of them that still holds the task isn't "running"
 * (P1-01): the view says the task is held by an ended attempt instead.
 */
const ENDED_ATTEMPT = new Set(["finished", "declined", "never_granted", "failed", "succeeded", "canceled", "cancelled", "expired", "stopped"]);
export const attemptEnded = (status: string | null | undefined) => !!status && ENDED_ATTEMPT.has(status.toLowerCase());
/**
 * List status: the lifecycle state, or running when an attempt holds the task (held when that attempt has ended).
 * List pages carry no readiness, so the ended-attempt rule is the list's own; `readiness`, the task's work read
 * when it is loaded (the inspected task), wins when the server says the task is held (aq-server #99).
 */
export function listStatus(task: { task_state: string | null }, holding: string | boolean | null | undefined, readiness?: string): TaskStatus {
  if (task.task_state === "active" && readiness === "held") return "held";
  if (task.task_state === "active") return !holding ? "active" : typeof holding === "string" && attemptEnded(holding) ? "held" : "running";
  return task.task_state === "draft" || task.task_state === "completed" || task.task_state === "canceled" ? task.task_state : "unknown";
}
/** Rare record states keep a short inline marker on the one-line row. */
export function recordMarker(task: { retired?: boolean; deleted?: boolean }): string | null {
  return task.deleted ? "Deleted" : task.retired ? "Retired" : null;
}
