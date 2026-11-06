import { useEffect, useState } from "react";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { ActionButton } from "../../../components/layout/Workspace";
import { HISTORY_MAX_PAGES, type HistoryEntry, type useTaskHistory } from "../taskWork";
import { Ago, humanize } from "./common";
import { ShowAll } from "./Section";
import styles from "./Inspector.module.css";

export const HISTORY_PREVIEW = 5;
const CATEGORY: Record<HistoryEntry["category"], string> = { revision: "Content", lifecycle: "Lifecycle", edge: "Relationship" };
/** Cursors expire after 30 seconds; an older first page is re-read before paging on. */
const CURSOR_FRESH_MS = 20_000;

/** Change history (item 5): who changed what and why, newest first, the last five until "Show all". */
export function TaskHistory({ query }: { query: ReturnType<typeof useTaskHistory> }) {
  const [all, setAll] = useState(false);
  const pages = query.data?.pages.length ?? 0;
  // Graph history pages run oldest first, so the newest entries need the whole (bounded) chain, one page at a time.
  useEffect(() => {
    if (!query.data || query.isFetching || query.isError || !query.hasNextPage) return;
    if (Date.now() - query.dataUpdatedAt > CURSOR_FRESH_MS && pages === 1) { void query.refetch(); return; }
    void query.fetchNextPage();
  }, [query, pages]);
  if (!query.data) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's history" subject="collection" retryLabel="task history" onRetry={() => void query.refetch()} />;
  const items = query.data.pages.flatMap(p => p.data.items);
  const newest = [...items].sort((a, b) => (BigInt(b.sequence) > BigInt(a.sequence) ? 1 : BigInt(b.sequence) < BigInt(a.sequence) ? -1 : 0));
  const reading = query.hasNextPage && !query.isError;
  const capped = pages >= HISTORY_MAX_PAGES && !!query.data.pages.at(-1)?.data.next_cursor;
  const shown = all ? newest : newest.slice(0, HISTORY_PREVIEW);
  return <>
    <RetainedNotice query={query} />
    {query.isFetchNextPageError && <div role="alert" className={styles.meta}><p>Older history couldn't be read, so the newest changes may be missing.</p><ActionButton onClick={() => void query.refetch()}>Read history again</ActionButton></div>}
    {reading && <p role="status" className={styles.meta}>Reading history…</p>}
    {capped && <p className={styles.meta}>This task has more than {items.length} history entries. The newest ones aren't shown here; use <code>aq task show</code> for the full history.</p>}
    {!reading && !newest.length ? <p className={styles.meta}>No history entries recorded.</p> : !reading && <>
      <ol className={styles.history} aria-label="Change history">{shown.map(h => <li key={h.entry_id}>
        <p><strong>{humanize(h.operation)}</strong> <span className={styles.meta}>{CATEGORY[h.category]}</span></p>
        <p className={styles.meta}><span>{h.actor_id}</span> · <Ago at={h.created_at} /></p>
        {h.reason && <p className={styles.historyReason}>{h.reason}</p>}
      </li>)}</ol>
      <ShowAll shown={HISTORY_PREVIEW} total={newest.length} noun="changes" expanded={all} onShowAll={setAll} />
    </>}
  </>;
}
