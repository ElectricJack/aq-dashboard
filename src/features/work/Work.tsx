import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { scopeSearch, useScope } from "../../app/scope";
import { READINESS_FILTERS, READINESS_LABEL } from "./labels";
import { TaskDetail } from "./TaskDetail";
import { TaskList } from "./TaskList";
import styles from "./Work.module.css";

export function Work() {
  const { taskId } = useParams();
  const [scope] = useScope();
  const [params, setParams] = useSearchParams();
  const readiness = params.get("readiness") ?? "";
  // Links keep scope and filters so Back and "All tasks" return to the same list.
  const search = params.toString() ? `?${params.toString()}` : scopeSearch(scope);

  const listRef = useRef<HTMLUListElement>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (taskId) {
      lastSelected.current = taskId;
      return;
    }
    const id = lastSelected.current;
    if (!id) return;
    const link = listRef.current?.querySelector<HTMLAnchorElement>(`li[data-task-id="${CSS.escape(id)}"] a`);
    link?.focus();
  }, [taskId]);

  return (
    <div className={styles.work} data-has-detail={taskId ? "true" : "false"}>
      <div className={styles.toolbar}>
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
      <div className={styles.panes}>
        <TaskList ref={listRef} scope={scope} readiness={readiness} selectedId={taskId} search={search} />
        {taskId && <TaskDetail key={taskId} taskId={taskId} search={search} />}
      </div>
    </div>
  );
}
