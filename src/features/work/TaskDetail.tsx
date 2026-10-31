import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { adaptTaskDetail, type TaskDetailView } from "../../api/adapters/inspection";
import type { TaskDetail as TaskDetailWire } from "../../api/wire/proposed";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge } from "../../components/time/relative";
import { FACT_LABEL } from "../../app/subjects";
import { useRead } from "../../app/useRead";
import { ATTEMPT_LABEL, FACT_STATE_LABEL, READINESS_LABEL } from "./labels";
import styles from "./Work.module.css";

/** Initial detail budget from docs/plans/0001 §2. */
const DETAIL_POLL_MS = 5_000;

export function TaskDetail({ taskId, search }: { taskId: string; search: string }) {
  const query = useRead<TaskDetailWire, TaskDetailView>({
    resource: "task",
    path: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    params: {},
    adapt: adaptTaskDetail,
    pollMs: DETAIL_POLL_MS,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useLocation().key !== "default";
  const loadedId = query.data?.view.id;
  useEffect(() => {
    if (navigated && loadedId === taskId) heading.current?.focus();
  }, [navigated, loadedId, taskId]);

  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="this task"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { view: t, serverTime } = query.data;
  const headingId = `task-${t.id}-heading`;

  return (
    <section className={styles.detail} aria-labelledby={headingId}>
      <Link to={{ pathname: "/work", search }} className={styles.back}>
        All tasks
      </Link>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.detailTitle}>
        {t.title}
      </h2>
      <p className={styles.rowMeta}>
        {t.project.label} · revision {t.revision} · updated {formatAge(serverTime, t.updatedAt)}
      </p>
      <div className={styles.readinessBox} data-readiness={t.readiness.state}>
        <strong>{READINESS_LABEL[t.readiness.state]}</strong>
        <span>{t.readiness.explanation}</span>
      </div>
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}

      <h3>Description</h3>
      <p className={styles.prose}>{t.description}</p>

      <h3 id={`${headingId}-criteria`}>Acceptance criteria · revision {t.acceptance.revision}</h3>
      <ul aria-labelledby={`${headingId}-criteria`} className={styles.bullets}>
        {t.acceptance.criteria.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>

      <h3>Dependencies</h3>
      {t.dependencies.length === 0 ? (
        <p className={styles.muted}>No dependencies reported.</p>
      ) : (
        <ul aria-label="Dependencies" className={styles.plainList}>
          {t.dependencies.map((d) => (
            <li key={d.task.id}>
              <Link to={{ pathname: `/work/${encodeURIComponent(d.task.id)}`, search }}>{d.task.title}</Link>
              <span className={styles.rowMeta}>
                {d.satisfied === null ? "Unknown" : d.satisfied ? "Satisfied" : "Not satisfied"} · {d.explanation}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Attempts</h3>
      {t.attempts.length === 0 ? (
        <p className={styles.muted}>No attempts yet.</p>
      ) : (
        <ul aria-label="Attempts" className={styles.plainList}>
          {t.attempts.map((a) => (
            <li key={a.id}>
              <span>
                Attempt {a.number} · {ATTEMPT_LABEL[a.outcome]}
              </span>
              <span className={styles.rowMeta}>
                started {formatAge(serverTime, a.startedAt)}
                {a.sessionId && (
                  <>
                    {" · "}
                    <Link to={{ pathname: `/agents/${encodeURIComponent(a.sessionId)}`, search }}>Open session</Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>Delivery</h3>
      <ul aria-label="Delivery facts" className={styles.facts}>
        {t.facts.map((f, i) => (
          <li key={`${f.kind}-${i}`} data-state={f.state}>
            <span>{FACT_LABEL[f.kind]}</span>
            <span>
              {FACT_STATE_LABEL[f.state]}
              {f.at && <> · {formatAge(serverTime, f.at)}</>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
