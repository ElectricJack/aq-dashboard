import type { ReadinessView, TaskDetailView } from "../../api/adapters/inspection";
import { nodeLabel } from "../../api/adapters/humanGraph";

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

/** Second row line: lifecycle, record retirement when present, revision ("Active · r1"). */
export function taskRowMeta(task: { task_state: string | null; content_revision: string; retired?: boolean; deleted?: boolean }): string {
  return [nodeLabel(task.task_state), task.deleted ? "Deleted record" : task.retired ? "Retired record" : null, `r${task.content_revision}`].filter(Boolean).join(" · ");
}

/** The Graph task read carries no readiness, agent or latest result; say so once. */
export const EXECUTION_UNAVAILABLE = "Execution details unavailable";
