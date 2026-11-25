import type { EntityRef } from "../api/wire/proposed";

const SUBJECT_ROUTES = new Map([
  ["task", "/work"], ["decision", "/decisions"], ["session", "/agents"],
  ["knowledge", "/knowledge"], ["playbook_run", "/playbooks/runs"],
]);

/** Dashboard route for an entity reference, or null when this client has no view for it. */
export function subjectPath(ref: EntityRef): string | null {
  const id = encodeURIComponent(ref.id);
  const base = SUBJECT_ROUTES.get(ref.type);
  if (base) return `${base}/${id}`;
  // History lists internal runs with its Internal filter on.
  if (ref.type === "internal_run") return "/agents/history?internal=1";
  if (ref.type !== "result" || !ref.revision) return null;
  // Overview references carry digest prefixes; the result route takes bare hex.
  const revision = encodeURIComponent(ref.revision.replace(/^sha256:/, ""));
  return `/results/${id}/revisions/${revision}`;
}

/** Outcome/fact labels shared by every surface (SO-04: `process_success` is a real outcome). */
export const FACT_LABEL: Record<string, string> = {
  process_success: "Process succeeded",
  process_failed: "Process failed",
  process_cancelled: "Process cancelled",
  process_expired: "Process expired",
  process_unknown: "Process outcome unknown",
  settlement_stale: "Settlement stale",
  settlement_needs_reconciliation: "Settlement needs reconciliation",
  settlement_accepted: "Settlement accepted",
  settlement_rejected: "Settlement rejected",
  source_retained: "Source retained",
  result_submitted: "Result submitted",
  result_accepted: "Result accepted",
  task_completed: "Task complete",
  candidate_published: "Candidate published",
  merged: "Merged",
  deployed: "Deployed",
  unsupported: "Unsupported outcome",
};
