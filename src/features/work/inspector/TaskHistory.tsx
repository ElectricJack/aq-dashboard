import { useEffect, useState } from "react";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { ActionButton } from "../../../components/layout/Workspace";
import { HISTORY_MAX_PAGES, type HistoryEntry, type useTaskHistory } from "../taskWork";
import { TaskHistoryEntry } from "./TaskHistoryEntry";
import { ShowAll } from "./Section";
import styles from "./Inspector.module.css";

export const HISTORY_PREVIEW = 5;
/** Cursors expire after 30 seconds; an older first page is re-read before paging on. */
const CURSOR_FRESH_MS = 20_000;

function useHistoryPages(query: ReturnType<typeof useTaskHistory>) {
  const pages = query.data?.pages.length ?? 0;
  // Graph history pages run oldest first, so the newest entries need the whole (bounded) chain, one page at a time.
  useEffect(() => {
    if (!query.data || !query.hasNextPage) return;
    if (query.isFetching || query.isError) return;
    if (Date.now() - query.dataUpdatedAt > CURSOR_FRESH_MS && pages === 1) { void query.refetch(); return; }
    void query.fetchNextPage();
  }, [query, pages]);
}

function historyCapped(pages: NonNullable<ReturnType<typeof useTaskHistory>["data"]>["pages"]) {
  return pages.length >= HISTORY_MAX_PAGES && Boolean(pages.at(-1)?.data.next_cursor);
}

function newestFirst(a: HistoryEntry, b: HistoryEntry) {
  const diff = BigInt(b.sequence) - BigInt(a.sequence);
  return Number(diff);
}

/** Change history (item 5): who changed what and why, newest first, the last five until "Show all". */
export function TaskHistory({ query }: { query: ReturnType<typeof useTaskHistory> }) {
  const [all, setAll] = useState(false);
  useHistoryPages(query);
  if (!query.data) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's history" subject="collection" retryLabel="task history" onRetry={() => void query.refetch()} />;
  const items = query.data.pages.flatMap(p => p.data.items);
  const newest = [...items].sort(newestFirst);
  const reading = query.hasNextPage && !query.isError;
  const capped = historyCapped(query.data.pages);
  return <>
    <RetainedNotice query={query} />
    {query.isFetchNextPageError && <div role="alert" className={styles.meta}><p>Older history couldn't be read, so the newest changes may be missing.</p><ActionButton onClick={() => void query.refetch()}>Read history again</ActionButton></div>}
    {reading && <p role="status" className={styles.meta}>Reading history…</p>}
    {capped && <p className={styles.meta}>This task has more than {items.length} history entries. The newest ones aren't shown here; use <code>aq task show</code> for the full history.</p>}
    {!reading && <HistoryEntries newest={newest} all={all} setAll={setAll} />}
  </>;
}


function HistoryEntries({ newest, all, setAll }: { newest: HistoryEntry[]; all: boolean; setAll(value: boolean): void }) {
  if (!newest.length) return <p className={styles.meta}>No history entries recorded.</p>;
  const shown = all ? newest : newest.slice(0, HISTORY_PREVIEW);
  return <>
      <ol className={styles.history} aria-label="Change history">{shown.map(h => <TaskHistoryEntry key={h.entry_id} entry={h} />)}</ol>
      <ShowAll shown={HISTORY_PREVIEW} total={newest.length} noun="changes" expanded={all} onShowAll={setAll} />
  </>;
}
