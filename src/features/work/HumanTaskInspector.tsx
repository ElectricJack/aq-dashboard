import { RecordActions } from "../actions/RecordActions";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useGraphNeighborhood } from "../../api/humanGraphReads";
import { type GraphEnvelope, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { DocumentBody } from "../knowledge/DocumentBody";
import { RecordFacts } from "../knowledge/KnowledgeDocument";
import styles from "../knowledge/HumanNodeWorkspace.module.css";

function TaskDependencies({ project, node, search }: { project: string; node: GraphNode; search: string }) {
  const query = useGraphNeighborhood(project, node.id);
  if (!query.data || query.isError) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="recorded task dependencies" onRetry={() => void query.refetch()} />;
  const { nodes, edges, truncated } = query.data.data;
  const related = edges.filter(e => e.source === node.id || e.target === node.id);
  return <>{truncated && <p className={styles.meta}>Some relationships are outside this bounded neighborhood.</p>}{related.length ? <ul className={styles.taskDependencies} aria-label="Recorded task dependencies">{related.map(edge => {
    const outgoing = edge.source === node.id, other = nodes.find(n => n.id === (outgoing ? edge.target : edge.source));
    const relation = edge.edge_type === "blocks" ? outgoing ? "This task blocks" : "Blocks this task" : edge.edge_type === "parent-child" ? outgoing ? "Contains" : "Part of" : edge.edge_type;
    return <li key={edge.id}><span className={styles.meta}>{relation}</span><Link to={{ pathname: `/work/${encodeURIComponent(other!.id)}`, search }}>{other!.title}</Link><span className={styles.meta}>{nodeLabel(other!.task_state)}</span></li>;
  })}</ul> : <p className={styles.meta}>No relationships among the tasks returned in this neighborhood.</p>}</>;
}
export function HumanTaskInspector({ record, search, notice }: { record: GraphEnvelope<GraphNode>; search: string; notice?: ReactNode }) {
  const n = record.data;
  return <Panel title={n.title} className={`${styles.detail} ${styles.taskInspector}`}>
    <Link to={{ pathname: "/work", search }} className={styles.back}>All tasks</Link>
    {notice}
    <p className={styles.taskEyebrow}>Task · revision {n.content_revision}</p>
    <p className={styles.taskState} data-state={n.task_state}>{nodeLabel(n.task_state)}</p>
    {(n.retired || n.deleted) && <p className={styles.meta}>Record lifecycle: {n.deleted ? "Deleted" : "Retired"}</p>}
    <RecordActions record={record} />
    <section><h3>Description</h3><DocumentBody body={n.body} /></section>
    <section><h3>Acceptance criteria</h3>{n.acceptance_criteria ? <DocumentBody body={n.acceptance_criteria} /> : <p className={styles.meta}>No acceptance criteria recorded.</p>}</section>
    <section><h3>Dependencies</h3><TaskDependencies project={record.project.id} node={n} search={search} /></section>
    <section><h3>Execution</h3><p className={styles.meta}>Execution readiness and agent assignment are not included in this task read.</p></section>
    <details className={styles.recordDisclosure}><summary>Record details and verification</summary><RecordFacts node={n} /></details>
    <p className={styles.footer}><span>Current revision {n.content_revision}</span> · Observed {record.observed_at}</p>
  </Panel>;
}
