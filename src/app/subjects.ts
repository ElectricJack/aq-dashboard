import type { EntityRef } from "../api/wire/proposed";

/** Dashboard route for an entity reference, or null when this client has no view for it. */
export function subjectPath(ref: EntityRef): string | null {
  const id = encodeURIComponent(ref.id);
  switch (ref.type) {
    case "task":
      return `/work/${id}`;
    case "decision":
      return `/decisions/${id}`;
    case "session":
      return `/agents/${id}`;
    case "knowledge":
      return `/knowledge/${id}`;
    case "playbook_run":
      return `/playbooks/runs/${id}`;
    case "result":
      // Overview references carry digests as `sha256:<hex>`; the results routes use the bare hex revision.
      return ref.revision ? `/results/${id}/revisions/${encodeURIComponent(ref.revision.replace(/^sha256:/, ""))}` : null;
    default:
      return null;
  }
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
