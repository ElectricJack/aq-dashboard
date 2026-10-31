import { useMemo } from "react";
import { useNavigate } from "react-router";
import { adaptTaskGraph, type TaskGraphView } from "../../../api/adapters/inspection";
import type { TaskGraph as TaskGraphWire } from "../../../api/wire/proposed";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { useRead } from "../../../app/useRead";
import { READINESS_LABEL } from "../labels";
import { layoutGraph, NODE_H, NODE_W } from "./layout";
import styles from "./TaskGraph.module.css";

const RELATION: Record<string, string> = {
  blocks: "must finish before",
  "parent-child": "contains",
  references: "references",
  motivated_by: "is motivated by",
  produces: "produces",
  supports: "supports",
  contradicts: "contradicts",
  supersedes: "supersedes",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Bounded dependency neighbourhood around `rootId`. Loaded lazily with its own chunk. */
export default function TaskGraph({ rootId, selectedId, search }: { rootId: string; selectedId: string | undefined; search: string }) {
  const navigate = useNavigate();
  const query = useRead<TaskGraphWire, TaskGraphView>({
    resource: "task-graph",
    path: `/api/v1/tasks/${encodeURIComponent(rootId)}/graph`,
    params: {},
    adapt: adaptTaskGraph,
  });
  const layout = useMemo(() => query.data && layoutGraph(query.data.view), [query.data]);

  if (!query.data || !layout) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="the dependency graph"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { view } = query.data;
  const titles = new Map(view.nodes.map((n) => [n.id, n.title]));
  const hiddenNodes = view.omitted.nodes + layout.clientOmitted;
  const hiddenEdges = view.omitted.edges;

  return (
    <section className={styles.graph} aria-label="Dependency graph">
      <p className={styles.summary}>
        {plural(layout.nodes.length, "task")} shown
        {(hiddenNodes > 0 || hiddenEdges > 0) && (
          <>
            {" · "}
            {plural(hiddenNodes, "task")} and {plural(hiddenEdges, "relationship")} not shown
            {view.omitted.reason && <> ({view.omitted.reason})</>}
          </>
        )}
      </p>
      <ul className={styles.legend} aria-label="Legend">
        <li data-category="dependency">Dependency</li>
        <li data-category="hierarchy">Hierarchy</li>
        <li data-category="informational">Related</li>
      </ul>
      <div className={styles.canvas}>
        <div className={styles.stage} style={{ inlineSize: layout.width, blockSize: layout.height }}>
          <svg width={layout.width} height={layout.height} aria-hidden="true" className={styles.edges}>
            <defs>
              <marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className={styles.arrow} />
              </marker>
            </defs>
            {layout.edges.map((e) => (
              <path
                key={`${e.from}-${e.to}-${e.type}`}
                d={e.path}
                data-category={e.category}
                markerEnd={e.category === "dependency" ? "url(#graph-arrow)" : undefined}
              />
            ))}
          </svg>
          {layout.nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className={styles.node}
              data-readiness={n.readiness.state}
              aria-pressed={n.id === selectedId}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
              onClick={() => navigate({ pathname: `/work/${encodeURIComponent(n.id)}`, search })}
            >
              <span className={styles.nodeTitle}>{n.title}</span>
              <span className={styles.nodeState}>
                {" · "}
                {READINESS_LABEL[n.readiness.state]}
              </span>
            </button>
          ))}
        </div>
      </div>
      <h3 className={styles.listHeading}>Relationships in this view</h3>
      {layout.edges.length === 0 ? (
        <p className={styles.muted}>No relationships among the shown tasks.</p>
      ) : (
        <ul aria-label="Relationships in this view" className={styles.relations}>
          {layout.edges.map((e) => (
            <li key={`${e.from}-${e.to}-${e.type}`}>
              {titles.get(e.from)} {RELATION[e.type] ?? e.type} {titles.get(e.to)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
