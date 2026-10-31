import { lazy, Suspense, useEffect, useRef } from "react";
import { Link } from "react-router";
import { useParams, useSearchParams } from "react-router";
import { scopeSearch, useScope } from "../../app/scope";
import { useMediaQuery } from "../../components/useMediaQuery";
import { READINESS_FILTERS, READINESS_LABEL } from "./labels";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import styles from "./Work.module.css";

const TaskGraph = lazy(() => import("./graph/TaskGraph"));

function withParams(params: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

export function Work() {
  const { taskId } = useParams();
  const [scope] = useScope();
  const [params, setParams] = useSearchParams();
  // A value this client doesn't offer is ignored rather than sent or shown as "All".
  const rawReadiness = params.get("readiness") ?? "";
  const readiness = (READINESS_FILTERS as readonly string[]).includes(rawReadiness) ? rawReadiness : "";
  const graphView = params.get("view") === "graph";
  const root = params.get("root") ?? taskId ?? null;
  // Wide screens show graph and inspector together, so Graph keeps the selection.
  // Narrower screens show one pane: Graph shows the graph, and a node opens its detail.
  const wide = useMediaQuery("(min-width: 1200px)");
  const graphPath = wide && taskId ? `/work/${encodeURIComponent(taskId)}` : "/work";
  // Links keep scope and filters so Back and "All tasks" return to the same list.
  const search = params.toString() ? `?${params.toString()}` : scopeSearch(scope);

  const listRef = useRef<HTMLUListElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (taskId) {
      lastSelected.current = taskId;
      return;
    }
    const id = lastSelected.current;
    if (!id) return;
    const sel = CSS.escape(id);
    const target = panesRef.current?.querySelector<HTMLElement>(
      `li[data-task-id="${sel}"] a, button[data-node-id="${sel}"]`,
    );
    target?.focus();
  }, [taskId]);

  return (
    <div className={styles.work} data-has-detail={taskId ? "true" : "false"} data-view={graphView ? "graph" : "list"}>
      <div className={styles.toolbar}>
        <nav aria-label="Work view" className={styles.views}>
          <Link
            to={{ search: withParams(params, { view: null, root: null }) }}
            aria-current={graphView ? undefined : "page"}
          >
            List
          </Link>
          <Link
            to={{ pathname: graphPath, search: withParams(params, { view: "graph", root }) }}
            aria-current={graphView ? "page" : undefined}
          >
            Graph
          </Link>
        </nav>
        <label>
          <span className="visually-hidden">Readiness</span>
          <select
            value={readiness}
            onChange={(e) =>
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                if (e.target.value) next.set("readiness", e.target.value);
                else next.delete("readiness");
                return next;
              })
            }
          >
            <option value="">All readiness</option>
            {READINESS_FILTERS.map((r) => (
              <option key={r} value={r}>
                {READINESS_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.panes} ref={panesRef}>
        {graphView ? (
          root ? (
            <div className={styles.listPane}>
              <Suspense fallback={<p role="status">Loading graph…</p>}>
                <TaskGraph rootId={root} selectedId={taskId} search={search} />
              </Suspense>
            </div>
          ) : (
            <p className={styles.muted}>Choose a task to see its dependency neighbourhood.</p>
          )
        ) : (
          <TaskList ref={listRef} scope={scope} readiness={readiness} selectedId={taskId} search={search} />
        )}
        {taskId && <TaskDetail key={taskId} taskId={taskId} search={search} />}
      </div>
    </div>
  );
}
