import { Link } from "react-router";
import { nodeLabel, type GraphEdge, type GraphNode } from "../../../api/adapters/humanGraph";
import { useGraphNeighborhood } from "../../../api/humanGraphReads";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { StatusIcon } from "../StatusIcon";
import { listStatus } from "../labels";
import { useTaskSummary, type TaskWork } from "../taskWork";
import { humanize } from "./common";
import { ChildCounts, Truncation } from "./NeighborhoodCounts";
import styles from "./Inspector.module.css";

function isChildEdge(edge: GraphEdge, id: string) {
  return edge.edge_type === "parent-child" && edge.source === id;
}

function isRelatedEdge(edge: GraphEdge, id: string) {
  const connected = edge.source === id || edge.target === id;
  return connected && !isChildEdge(edge, id);
}

function otherNode(edge: GraphEdge, self: string) {
  return edge.source === self ? edge.target : edge.source;
}

function satisfaction(done: boolean | null | undefined, work: TaskWork | undefined) {
  if (done === true) return "Satisfied";
  if (done === false) return "Not satisfied";
  return work ? "Satisfaction unknown" : "Checking…";
}

const descriptions = new Map<string, [string, string]>([
  ["blocks", ["This task blocks", "Blocks this task"]],
  ["parent-child", ["Contains", "Part of"]],
]);

function relation(edge: GraphEdge, self: string) {
  return descriptions.get(edge.edge_type)?.[edge.source === self ? 0 : 1] ?? humanize(edge.edge_type);
}

function TaskLink({ node, search }: { node: GraphNode; search: string }) {
  return <Link to={{ pathname: `/work/${encodeURIComponent(node.id)}`, search }}>{node.title}</Link>;
}

/** Dependencies and hierarchy (item 6): parent, child counts, dependency reasons and whether each is satisfied. */
export function TaskHierarchy({ project, node, work, search }: { project: string; node: GraphNode; work: TaskWork | undefined; search: string }) {
  const query = useGraphNeighborhood(project, node.id);
  const g = query.data?.data;
  const children = (g?.edges ?? []).filter(e => isChildEdge(e, node.id));
  const summary = useTaskSummary(project, node.id, children.length > 0);
  if (!g) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="recorded task dependencies" retryLabel="task dependencies" onRetry={() => void query.refetch()} />;
  const related = g.edges.filter(e => isRelatedEdge(e, node.id));
  const satisfied = new Map((work?.blockers ?? []).map(b => [b.edge_id, b.satisfied]));
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  return <>
    <RetainedNotice query={query} />
    {children.length > 0 && <div className={styles.children} data-children="">
      <h4>Child tasks</h4>
      <ChildCounts summary={summary.data?.data} failed={summary.isError} />
      <ul className={styles.dependencies} aria-label="Child tasks">{children.map(e => { const c = byId.get(e.target)!; return <li key={e.id}>
        <StatusIcon status={listStatus(c, false)} size={14} /><TaskLink node={c} search={search} /></li>; })}</ul>
    </div>}
    {related.length ? <ul className={styles.dependencies} aria-label="Recorded task dependencies">{related.map(edge => {
      const other = byId.get(otherNode(edge, node.id))!;
      return <RelatedTask key={edge.id} edge={edge} self={node.id} other={other} search={search} work={work} done={satisfied.get(edge.id)} />;
    })}</ul> : !children.length && <p className={styles.meta}>No relationships among the tasks returned in this neighborhood.</p>}
    <Truncation truncated={g.truncated} omitted={g.omitted} />
  </>;
}

function RelatedTask({ edge, self, other, search, work, done }: {
  edge: GraphEdge; self: string; other: GraphNode; search: string; work: TaskWork | undefined; done: boolean | null | undefined;
}) {
  const blocker = edge.edge_type === "blocks" && edge.target === self;
  return <li data-edge={edge.edge_type}>
    <span className={styles.meta}>{relation(edge, self)}</span>
    <span className={styles.dependencyTitle}><StatusIcon status={listStatus(other, false)} size={14} /><TaskLink node={other} search={search} /></span>
    {edge.description && <span className={styles.edgeReason}>{edge.description}</span>}
    <span className={styles.meta}>{nodeLabel(other.task_state)}{blocker && ` · ${satisfaction(done, work)}`}</span>
  </li>;
}
