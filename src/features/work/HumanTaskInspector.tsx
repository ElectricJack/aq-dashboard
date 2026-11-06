import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { RecordActions } from "../actions/RecordActions";
import { useGraphNeighborhood } from "../../api/humanGraphReads";
import { type GraphEnvelope, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge } from "../../components/time/relative";
import { DocumentBody } from "../knowledge/DocumentBody";
import { RecordFacts } from "../knowledge/KnowledgeDocument";
import { CopyValue } from "../decisions/DecisionContext";
import { useTaskWork, type TaskWork } from "./taskWork";
import styles from "./HumanTaskInspector.module.css";

const classes = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");
/** Links out of the inspector open in list mode: graph view and graph root are inspector context only. */
function listSearch(search: string) {
  const params = new URLSearchParams(search);
  params.delete("view"); params.delete("root");
  const value = params.toString();
  return value ? `?${value}` : "";
}
function BackToTasks({ search, always }: { search: string; always?: boolean }) {
  return <Link to={{ pathname: "/work", search: listSearch(search) }} className={classes(styles.back, always ? styles.backAlways : undefined)}><ArrowLeft size={16} aria-hidden />All tasks</Link>;
}

function TaskDependencies({ project, node, search }: { project: string; node: GraphNode; search: string }) {
  const query = useGraphNeighborhood(project, node.id);
  if (!query.data || query.isError) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="recorded task dependencies" onRetry={() => void query.refetch()} />;
  const { nodes, edges, truncated } = query.data.data;
  const related = edges.filter(e => e.source === node.id || e.target === node.id);
  return <>{truncated && <p className={styles.meta}>Some relationships are outside this bounded neighborhood.</p>}{related.length ? <ul className={styles.dependencies} aria-label="Recorded task dependencies">{related.map(edge => {
    const outgoing = edge.source === node.id, other = nodes.find(n => n.id === (outgoing ? edge.target : edge.source));
    const relation = edge.edge_type === "blocks" ? outgoing ? "This task blocks" : "Blocks this task" : edge.edge_type === "parent-child" ? outgoing ? "Contains" : "Part of" : edge.edge_type;
    return <li key={edge.id}><span className={styles.meta}>{relation}</span><Link to={{ pathname: `/work/${encodeURIComponent(other!.id)}`, search }}>{other!.title}</Link><span className={styles.meta}>{nodeLabel(other!.task_state)}</span></li>;
  })}</ul> : <p className={styles.meta}>No relationships among the tasks returned in this neighborhood.</p>}</>;
}

/** The attempt holding the task, from the work read; nothing is claimed while it is unknown. */
function TaskExecution({ work, failed, search }: { work: TaskWork | undefined; failed: boolean; search: string }) {
  if (!work) return <p className={styles.meta}>{failed ? "Agent attempt state unavailable for this task." : "Checking for an agent attempt…"}</p>;
  if (!work.execution) return <p className={styles.meta}>No agent attempt holds this task.</p>;
  const e = work.execution;
  return <p className={styles.meta}>An agent attempt holds this task · {e.status.replace(/_/g, " ")} · <Link to={{ pathname: `/agents/${encodeURIComponent(e.session_id)}`, search: listSearch(search) }}>Open session</Link></p>;
}

/** Work's contextual task inspector (design reference 02): identity, one action row, then the task's content.
 * It is the single task view (spec 0004 §3); there is no separate full-task page. */
export function HumanTaskInspector({ record, search, notice, className }: { record: GraphEnvelope<GraphNode>; search: string; notice?: ReactNode; className?: string }) {
  const n = record.data;
  const work = useTaskWork(record.project.id, n.id);
  return <Panel title={n.title} className={classes(styles.inspector, className)} data-task-inspector=""
    description={`Task · revision ${n.content_revision}`}>
    <BackToTasks search={search} />
    <div className={styles.identity}>
      <p className={styles.state} data-state={n.task_state}>{nodeLabel(n.task_state)}</p>
      <p className={styles.taskId}><span className="visually-hidden">Task ID </span><code data-task-id="">{n.id}</code><CopyValue value={n.id} label="task ID" /></p>
      {(n.retired || n.deleted) && <p className={styles.meta}>Record lifecycle: {n.deleted ? "Deleted" : "Retired"}</p>}
    </div>
    {n.labels.length > 0 && <ul className={styles.labels} aria-label="Labels">{n.labels.map(l => <li key={l}>{l}</li>)}</ul>}
    {notice}
    <RecordActions record={record} variant="compact" execution={work.data ? { holding: !!work.data.data.execution, blockers: work.data.data.blockers.length, complete: work.data.data.complete } : undefined} />
    <section className={styles.section}><h3>Description</h3><DocumentBody body={n.body} /></section>
    <section className={styles.section}><h3>Acceptance criteria</h3>{n.acceptance_criteria ? <DocumentBody body={n.acceptance_criteria} /> : <p className={styles.meta}>No acceptance criteria recorded.</p>}</section>
    <section className={styles.section}><h3>Dependencies</h3><TaskDependencies project={record.project.id} node={n} search={search} /></section>
    <section className={styles.section}><h3>Execution</h3><TaskExecution work={work.data?.data} failed={work.isError} search={search} /></section>
    <details className={styles.disclosure}><summary>Record details and verification</summary><RecordFacts node={n} /></details>
    <p className={styles.footer}>
      <span>Revision {n.content_revision}</span> · <span>Updated <time dateTime={n.updated_at} title={n.updated_at}>{formatAge(record.observed_at, n.updated_at)}</time></span>
      {" "}· <span>Observed <time dateTime={record.observed_at} title={record.observed_at}>{record.observed_at}</time></span>
    </p>
  </Panel>;
}

/** A task that cannot be read keeps the inspector's frame and an exit back to the task list. */
export function TaskInspectorUnavailable({ search, className, status, busy }: { search: string; className?: string; status: ReactNode; busy?: boolean }) {
  // While loading, `aria-busy` also keeps selection focus waiting for the task heading itself.
  return <Panel title="Task" className={classes(styles.inspector, className)} aria-busy={busy || undefined}>
    {status}
    <BackToTasks search={search} always />
  </Panel>;
}
