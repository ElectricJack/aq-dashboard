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
      return ref.revision ? `/results/${id}/revisions/${encodeURIComponent(ref.revision)}` : null;
    default:
      return null;
  }
}

export const FACT_LABEL: Record<string, string> = {
  source_retained: "Source retained",
  result_submitted: "Result submitted",
  result_accepted: "Result accepted",
  task_completed: "Task complete",
  candidate_published: "Candidate published",
  merged: "Merged",
  deployed: "Deployed",
  unsupported: "Unsupported outcome",
};
