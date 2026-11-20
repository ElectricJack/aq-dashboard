import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import type { HostDecisionDetail } from "../../api/adapters/hostDecisions";
import type { GraphNeighborhood, GraphNode } from "../../api/adapters/humanGraph";
import { validStoryPoints } from "../../api/adapters/storyPoints";
import { useGraphDetail, useGraphNeighborhood } from "../../api/humanGraphReads";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton } from "../../components/layout/Workspace";
import { DocumentBody } from "../knowledge/DocumentBody";
import { documentChanges } from "./documentChanges";
import styles from "./HostDecision.module.css";

export function hostWorkLink(project: string, task: string) {
  return { pathname: `/work/${task}`, search: new URLSearchParams({ scope: `project:${project}` }).toString() };
}

function Labels({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return <ul className={styles.labels} aria-label="Labels">
    {Array.from(new Set(labels)).map(label => <li key={label}>{label}</li>)}
  </ul>;
}

function ProducedDocument({ id, project, workspace }: { id: string; project: string; workspace: string }) {
  const current = useGraphDetail(project, "knowledge", id);
  const [comparing, setComparing] = useState(false);
  const node = !current.isError && current.data?.project.workspace_id === workspace ? current.data.data : undefined;

  if (!current.data || current.isError) return <QueryStatus status={current.isError ? "error" : "pending"}
    error={current.error} label="produced document" onRetry={() => void current.refetch()} />;
  if (!node || node.deleted) return <p role="status">This produced document is unavailable.</p>;

  return <article className={styles.document}>
    <h4>{node.title}</h4>
    <p className={styles.meta}>Version {node.content_revision}</p>
    <Labels labels={node.labels} />
    <DocumentBody body={node.body} />
    {node.content_revision !== "1" && <details className={styles.diffDisclosure} onToggle={event => setComparing(event.currentTarget.open)}>
      <summary>Changes since previous version</summary>
      {comparing && <PreviousVersion project={project} workspace={workspace} node={node} />}
    </details>}
  </article>;
}

function PreviousVersion({ project, workspace, node }: { project: string; workspace: string; node: GraphNode }) {
  const revision = (BigInt(node.content_revision) - 1n).toString();
  const previous = useGraphDetail(project, "knowledge", node.id, revision);
  const before = !previous.isError && previous.data?.project.workspace_id === workspace ? previous.data.data.body : undefined;
  const changes = useMemo(() => before === undefined ? null : documentChanges(before, node.body), [before, node.body]);

  if (!previous.data || previous.isError) return <QueryStatus status={previous.isError ? "error" : "pending"}
    error={previous.error} label="previous document version" onRetry={() => void previous.refetch()} />;
  if (before === undefined) return <p role="status">The previous document version is unavailable.</p>;
  if (changes === null) return <p role="status">The document exceeds the size limit for comparing versions.</p>;
  if (changes.length === 0) return <p>No changes to the document body.</p>;
  return <ul className={styles.diff} aria-label="Document changes">
    {changes.map(change => <li key={`${change.kind}:${change.line}`} className={styles[change.kind]}>
      <span aria-hidden="true">{change.kind === "added" ? "+" : "−"}{change.line}</span>
      <span className="visually-hidden">{change.kind === "added" ? "Added" : "Removed"} line {change.line} </span>
      <code>{change.text}</code>
    </li>)}
  </ul>;
}

function points(node: GraphNode) {
  const estimates = [...new Set(node.labels.filter(label => /^sp:[1-9]\d*$/.test(label)))];
  const value = Number(estimates.length === 1 ? estimates[0]!.slice(3) : NaN);
  return validStoryPoints(value) ? value : node.story_points ?? null;
}

function DraftTaskTable({ graph, project, workspace }: { graph: GraphNeighborhood; project: string; workspace: string }) {
  const headingId = useId();
  const childIds = new Set(graph.edges.filter(edge => edge.edge_type === "parent-child" && edge.source === graph.root_id).map(edge => edge.target));
  const drafts = graph.nodes.filter(node => childIds.has(node.id) && node.task_state === "draft" && !node.deleted);
  const rows = drafts.map(node => ({ node, points: points(node) }));
  return <>
    <h3 id={headingId}>Draft child tasks</h3>
    {rows.length > 0 ? <div className={styles.tableRegion} role="region" aria-labelledby={headingId} tabIndex={0}>
      <table className={styles.table} aria-labelledby={headingId}>
        <thead><tr><th scope="col">Title</th><th scope="col">Labels</th><th scope="col">Points</th><th scope="col">Blocked by</th></tr></thead>
        <tbody>{rows.map(({ node, points }) => <tr key={node.id}>
          <th scope="row"><Link to={hostWorkLink(project, node.id)}>{node.title}</Link></th>
          <td><Labels labels={node.labels} /></td>
          <td>{points ?? "—"}</td>
          <td><DraftTaskBlockers project={project} workspace={workspace} node={node} /></td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>Total points shown</th><td>{rows.reduce((sum, row) => sum + (row.points ?? 0), 0)}</td><td /></tr></tfoot>
      </table>
    </div> : <p>{graph.truncated ? "No draft child tasks in the graph returned." : "No draft child tasks."}</p>}
    {graph.truncated && <p className={styles.meta}>The graph is bounded and may omit child tasks.</p>}
  </>;
}

function DraftTaskBlockers({ project, workspace, node }: { project: string; workspace: string; node: GraphNode }) {
  // A depth-one graph contains edges incident to its root. Read the child's graph
  // to see dependencies between siblings and blockers outside the proposed tasks.
  const read = useGraphNeighborhood(project, node.id);
  if (read.isError) return <ActionButton onClick={() => void read.refetch()} aria-label={`Retry blockers for ${node.title}`}>Retry blockers</ActionButton>;
  if (!read.data) return <span className={styles.meta}>Loading…</span>;
  if (read.data.project.workspace_id !== workspace) return <span className={styles.meta}>Unavailable</span>;
  const { nodes, edges, truncated } = read.data.data;
  const blockerIds = new Set(edges.filter(edge => edge.edge_type === "blocks" && edge.target === node.id).map(edge => edge.source));
  const blockers = nodes.filter(source => blockerIds.has(source.id));
  return <>
    {blockers.length > 0 && <ul className={styles.blockers}>
      {blockers.map(source => <li key={source.id}><Link to={hostWorkLink(project, source.id)}>{source.title}</Link></li>)}
    </ul>}
    {truncated ? <span className={styles.meta}>Partial graph</span> : blockers.length === 0 && "—"}
  </>;
}

export function HostDecisionEvidence({ decision, graphProject }: { decision: HostDecisionDetail; graphProject: string }) {
  const { producedKnowledgeIds, taskId, workspaceId } = decision;
  const graph = useGraphNeighborhood(graphProject, taskId ?? "");
  if (!taskId) return null;
  return <>
    <section className={styles.evidence}>
      <h3>Produced documents</h3>
      {!graphProject || producedKnowledgeIds === null ? <p role="status">Produced documents are unavailable.</p>
        : producedKnowledgeIds.length === 0 ? <p>No document produced</p>
        : producedKnowledgeIds.map(id => <ProducedDocument key={id} id={id} project={graphProject} workspace={workspaceId} />)}
    </section>
    <section className={styles.evidence}>
      {!graphProject || (graph.data && graph.data.project.workspace_id !== workspaceId) ? <p role="status">Draft child tasks are unavailable.</p>
        : !graph.data || graph.isError ? <QueryStatus status={graph.isError ? "error" : "pending"}
          error={graph.error} label="draft child tasks" onRetry={() => void graph.refetch()} />
        : <DraftTaskTable graph={graph.data.data} project={graphProject} workspace={workspaceId} />}
    </section>
  </>;
}
