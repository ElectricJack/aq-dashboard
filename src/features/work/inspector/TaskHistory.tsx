import { useEffect, useState } from "react";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { ActionButton } from "../../../components/layout/Workspace";
import { HISTORY_MAX_PAGES, type HistoryChange, type HistoryEntry, type useTaskHistory } from "../taskWork";
import { Ago, IdValue, humanize } from "./common";
import { ShowAll } from "./Section";
import styles from "./Inspector.module.css";

export const HISTORY_PREVIEW = 5;
const CATEGORY: Record<HistoryEntry["category"], string> = { revision: "Content", lifecycle: "Lifecycle", edge: "Relationship" };
/** Field names as the owner knows them; a field this bundle doesn't know is humanized. */
const FIELD: Record<string, string> = { task_state: "State", acceptance_criteria: "Acceptance criteria", content_type: "Content type", retirement_reason: "Retirement reason", successor_id: "Successor", valid_from: "Valid from", valid_until: "Valid until", review_at: "Review date" };
const fieldName = (field: string) => FIELD[field] ?? humanize(field);

/**
 * What the entry changed (aq-server #99): AQ's summary, then each field, with `from → to` where AQ gives the
 * values (state, priority, content type, retired, deleted). "Partial" when AQ couldn't compare the revision.
 */
function Change({ change }: { change: HistoryChange }) {
  const valued = change.fields.filter(f => f.from !== null || f.to !== null), named = change.fields.filter(f => f.from === null && f.to === null);
  return <div className={styles.historyChange} data-history-change="">
    {(change.summary || !change.complete) && <p>{change.summary}{!change.complete && <span className={styles.partial} title="AQ couldn't read the previous revision, so this change may be incomplete."> Partial</span>}</p>}
    {valued.length > 0 && <p className={styles.historyValues}>{valued.map(f => <span key={f.field} data-field={f.field}>
      <span>{fieldName(f.field)}</span> {f.from !== null ? <><span>{f.from}</span> <span aria-hidden>→</span><span className="visually-hidden">to</span> </> : null}<span>{f.to ?? "none"}</span>
    </span>)}</p>}
    {named.length > 0 && <p className={styles.meta}>Changed: {named.map(f => fieldName(f.field)).join(", ")}</p>}
    {change.edge && <p className={styles.meta}><span>{humanize(change.edge.edge_type)} {change.edge.direction === "incoming" ? "from" : "to"}</span> <IdValue id={change.edge.node_id} label="related node ID" /></p>}
  </div>;
}

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
        {/* Operation, kind, who and when on one line (v1 density, 2026-11-06); what changed and why below. */}
        <p><strong>{humanize(h.operation)}</strong> <span className={styles.meta}>{CATEGORY[h.category]} · <span>{h.actor_id}</span> · <Ago at={h.created_at} /></span></p>
        {h.change && <Change change={h.change} />}
        {h.reason && <p className={styles.historyReason}>{h.reason}</p>}
      </li>)}</ol>
      <ShowAll shown={HISTORY_PREVIEW} total={newest.length} noun="changes" expanded={all} onShowAll={setAll} />
    </>}
  </>;
}
