import { Link } from "react-router";
import { nodeLabel, type GraphEdge, type GraphNode, type GraphOmitted } from "../../../api/adapters/humanGraph";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { StatusIcon } from "../StatusIcon";
import { listStatus } from "../labels";
import { useTaskSummary, type TaskSummary, type TaskWork } from "../taskWork";
import { humanize } from "./common";
import styles from "./Inspector.module.css";

const STATES = ["active", "draft", "completed", "canceled", "unknown"] as const;
const countsText = (by: Record<(typeof STATES)[number], string>) => STATES.filter(s => by[s] !== "0").map(s => `${by[s]} ${s === "unknown" ? "unknown" : nodeLabel(s).toLowerCase()}`).join(", ");

function relation(edge: GraphEdge, self: string) {
  const outgoing = edge.source === self;
  return edge.edge_type === "blocks" ? outgoing ? "This task blocks" : "Blocks this task" : edge.edge_type === "parent-child" ? outgoing ? "Contains" : "Part of" : humanize(edge.edge_type);
}

/** Dependencies and hierarchy (item 6): parent, child counts, dependency reasons and whether each is satisfied. */
export function TaskHierarchy({ project, node, work, search }: { project: string; node: GraphNode; work: TaskWork | undefined; search: string }) {
  const query = useGraphNeighborhood(project, node.id);
  const g = query.data?.data;
  const children = g ? g.edges.filter(e => e.edge_type === "parent-child" && e.source === node.id) : [];
  const summary = useTaskSummary(project, node.id, children.length > 0);
  if (!g) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="recorded task dependencies" retryLabel="task dependencies" onRetry={() => void query.refetch()} />;
  const related = g.edges.filter(e => (e.source === node.id || e.target === node.id) && !(e.edge_type === "parent-child" && e.source === node.id));
  const satisfied = new Map((work?.blockers ?? []).map(b => [b.edge_id, b.satisfied]));
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  const link = (n: GraphNode) => <Link to={{ pathname: `/work/${encodeURIComponent(n.id)}`, search }}>{n.title}</Link>;
  return <>
    <RetainedNotice query={query} />
    {children.length > 0 && <div className={styles.children} data-children="">
      <h4>Child tasks</h4>
      <ChildCounts summary={summary.data?.data} failed={summary.isError} />
      <ul className={styles.dependencies} aria-label="Child tasks">{children.map(e => { const c = byId.get(e.target)!; return <li key={e.id}>
        <StatusIcon status={listStatus(c, false)} size={14} />{link(c)}</li>; })}</ul>
    </div>}
    {related.length ? <ul className={styles.dependencies} aria-label="Recorded task dependencies">{related.map(edge => {
      const other = byId.get(edge.source === node.id ? edge.target : edge.source)!;
      const blocker = edge.edge_type === "blocks" && edge.target === node.id, done = satisfied.get(edge.id);
      return <li key={edge.id} data-edge={edge.edge_type}>
        <span className={styles.meta}>{relation(edge, node.id)}</span>
        <span className={styles.dependencyTitle}><StatusIcon status={listStatus(other, false)} size={14} />{link(other)}</span>
        {edge.description && <span className={styles.edgeReason}>{edge.description}</span>}
        <span className={styles.meta}>{nodeLabel(other.task_state)}{blocker && ` · ${done === true ? "Satisfied" : done === false ? "Not satisfied" : work ? "Satisfaction unknown" : "Checking…"}`}</span>
      </li>;
    })}</ul> : !children.length && <p className={styles.meta}>No relationships among the tasks returned in this neighborhood.</p>}
    <Truncation truncated={g.truncated} omitted={g.omitted} />
  </>;
}

function ChildCounts({ summary, failed }: { summary: TaskSummary | undefined; failed: boolean }) {
  if (!summary) return <p className={styles.meta}>{failed ? "Child counts unavailable." : "Counting child tasks…"}</p>;
  return <p data-child-counts="">{summary.complete ? "" : "At least "}{summary.total} {summary.total === "1" ? "descendant" : "descendants"}{summary.total !== "0" && `: ${countsText(summary.by_state)}`}</p>;
}

/** The neighborhood is bounded; say what it left out rather than implying the list is complete (X10). */
function Truncation({ truncated, omitted }: { truncated: boolean; omitted: GraphOmitted | null }) {
  const tasks = omitted && omitted.tasks !== "0", others = omitted && (omitted.other_nodes !== "0" || omitted.edges !== "0");
  if (!truncated && !tasks && !others) return null;
  const parts = [tasks && `${omitted!.exact ? "" : "at least "}${omitted!.tasks} related ${omitted!.tasks === "1" ? "task" : "tasks"} (${countsText(omitted!.tasks_by_state)})`,
    others && omitted!.edges !== "0" && `${omitted!.edges} ${omitted!.edges === "1" ? "relationship" : "relationships"}`].filter(Boolean);
  return <p className={styles.meta} data-truncated="">{parts.length ? `Not shown: ${parts.join(" and ")}.` : "Some relationships are outside this bounded neighborhood."}</p>;
}
