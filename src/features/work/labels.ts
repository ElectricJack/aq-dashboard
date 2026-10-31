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
