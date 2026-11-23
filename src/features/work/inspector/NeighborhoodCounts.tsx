import { nodeLabel, type GraphOmitted } from "../../../api/adapters/humanGraph";
import type { TaskSummary } from "../taskWork";
import styles from "./Inspector.module.css";

const STATES = ["active", "draft", "completed", "canceled", "unknown"] as const;
const countsText = (by: Record<(typeof STATES)[number], string>) => STATES.filter(s => by[s] !== "0").map(s => `${by[s]} ${s === "unknown" ? "unknown" : nodeLabel(s).toLowerCase()}`).join(", ");

export function ChildCounts({ summary, failed }: { summary: TaskSummary | undefined; failed: boolean }) {
  if (!summary) return <p className={styles.meta}>{failed ? "Child counts unavailable." : "Counting child tasks…"}</p>;
  return <p data-child-counts="">{summary.complete ? "" : "At least "}{summary.total} {summary.total === "1" ? "descendant" : "descendants"}{summary.total !== "0" && `: ${countsText(summary.by_state)}`}</p>;
}

function omittedParts(omitted: GraphOmitted) {
  const parts: string[] = [];
  if (omitted.tasks !== "0") {
    const number = omitted.exact ? omitted.tasks : `at least ${omitted.tasks}`;
    const label = omitted.tasks === "1" ? "task" : "tasks";
    parts.push(`${number} related ${label} (${countsText(omitted.tasks_by_state)})`);
  }
  if (omitted.edges !== "0") parts.push(`${omitted.edges} ${omitted.edges === "1" ? "relationship" : "relationships"}`);
  return parts;
}

/** The neighborhood is bounded; say what it left out rather than implying the list is complete (X10). */
export function Truncation({ truncated, omitted }: { truncated: boolean; omitted: GraphOmitted | null }) {
  const parts = omitted ? omittedParts(omitted) : [];
  const hasOmissions = parts.length > 0 || (omitted && omitted.other_nodes !== "0");
  if (!truncated && !hasOmissions) return null;
  return <p className={styles.meta} data-truncated="">{parts.length ? `Not shown: ${parts.join(" and ")}.` : "Some relationships are outside this bounded neighborhood."}</p>;
}
