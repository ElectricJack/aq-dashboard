import { useInfiniteQuery } from "@tanstack/react-query";
import { forwardRef } from "react";
import { Link } from "react-router";
import { adaptPage, adaptTaskSummary, type PageView, type TaskSummaryView } from "../../api/adapters/inspection";
import { apiGet } from "../../api/client";
import { scopedKey } from "../../api/queryKeys";
import type { Coverage, Envelope, Page, Scope, TaskSummary } from "../../api/wire/proposed";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useSession } from "../../app/session";
import { readUrl } from "../../app/useRead";
import { READINESS_LABEL } from "./labels";
import styles from "./Work.module.css";

const PAGE_SIZE = 25;

type Props = { scope: Scope; readiness: string; selectedId: string | undefined; search: string };

function countText(loaded: number, total: PageView<unknown>["total"]): string {
  if (total.value === null) return `${loaded} tasks loaded`;
  return `${loaded} of ${total.accuracy === "estimated" ? "~" : ""}${total.value} tasks`;
}

export const TaskList = forwardRef<HTMLUListElement, Props>(function TaskList(
  { scope, readiness, selectedId, search },
  ref,
) {
  const { queryContext } = useSession();
  const params = { readiness, limit: PAGE_SIZE };
  const query = useInfiniteQuery({
    queryKey: scopedKey(queryContext, scope, "tasks", params),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const env = await apiGet<Envelope<Page<TaskSummary>>>(
        readUrl("/api/v1/tasks", { ...params, cursor: pageParam }, scope),
        signal,
      );
      return { page: adaptPage(env.data, adaptTaskSummary), coverage: env.coverage as Coverage };
    },
    getNextPageParam: (last) => (last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined),
    // A cursor-paged list must not re-page itself under the reader (D-A04).
    refetchOnWindowFocus: false,
  });

  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="tasks"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const pages = query.data.pages;
  const items: TaskSummaryView[] = pages.flatMap((p) => p.page.items);
  const total = pages[0]!.page.total;
  const complete = pages.every((p) => p.coverage.state === "complete");

  return (
    <div className={styles.listPane}>
      <div className={styles.listMeta}>
        <span role="status">{countText(items.length, total)}</span>
        <button type="button" className={styles.secondary} onClick={() => void query.refetch()}>
          Refresh list
        </button>
      </div>
      {!complete && <p className={styles.warning}>Some projects didn't respond, so this list may be incomplete.</p>}
      {items.length === 0 ? (
        complete && <p className={styles.muted}>No tasks match these filters</p>
      ) : (
        <ul ref={ref} className={styles.list} aria-label="Tasks">
          {items.map((t) => (
            <li key={t.id} data-task-id={t.id} className={styles.row} data-readiness={t.readiness.state}>
              <Link
                to={{ pathname: `/work/${encodeURIComponent(t.id)}`, search }}
                className={styles.rowLink}
                aria-current={t.id === selectedId ? "page" : undefined}
              >
                {t.title}
              </Link>
              <span className={styles.rowMeta}>
                {t.project.label} · <span className={styles.readiness}>{READINESS_LABEL[t.readiness.state]}</span>
                {t.execution.agentLabel && <> · {t.execution.agentLabel}</>}
              </span>
              <span className={styles.rowExplain}>{t.blocker?.explanation ?? t.readiness.explanation}</span>
              {t.latestResult && <span className={styles.rowMeta}>Latest result: {t.latestResult.summary}</span>}
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className={styles.secondary}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more tasks"}
        </button>
      )}
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}
    </div>
  );
});
