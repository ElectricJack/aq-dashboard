import { useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { adaptSessionEvents, mergeEventPages, type EventsPage, type EventsCursor } from "../../api/adapters/sessionEvents";
import { sessionEventsJson } from "../../api/sessionEventsClient";
import { queryKey } from "../../api/queryKeys";
import type { UsageBinding } from "../../api/wire/sessionUsage";
import { useSession } from "../../app/session";
import { ActionButton, DetailList, Toolbar } from "../../components/layout/Workspace";
import styles from "./SessionEvents.module.css";

const date = (value: number) => new Date(value).toISOString();
/** Explicitly loaded inside Session details; no row performs its own fetch. */
export function SessionEvents({ binding }: { binding: UsageBinding }) {
  const { queryContext } = useSession();
  const client = useQueryClient(); const [started, setStarted] = useState(false), [snapshot, setSnapshot] = useState(0);
  const key = queryKey(queryContext, "session-source-events", { binding, snapshot });
  const query = useInfiniteQuery({ queryKey: key, initialPageParam: { after: 0 } as EventsCursor, enabled: started,
    queryFn: async ({ pageParam, signal }) => {
      const page = await adaptSessionEvents(await sessionEventsJson(binding.attempt_id, pageParam, signal), binding, pageParam);
      const previous = pageParam.after === 0 ? [] : client.getQueryData<InfiniteData<EventsPage>>(key)?.pages ?? [];
      mergeEventPages([...previous, page]); return page;
    },
    getNextPageParam: (last, pages): EventsCursor | undefined => pages.length < 4 && last.next !== null ? { after: last.next, through: last.through } : undefined,
    retry: false, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const pages = query.data?.pages, rows = pages ? mergeEventPages(pages) : [], last = pages?.at(-1);
  const refresh = () => setSnapshot(value => value + 1);
  return <section className={styles.events} aria-label="Session source events">
    <h3>Source events</h3>
    <p className={styles.note}>Reported activity and source gaps. These reports are separate from terminal output and current execution authority.</p>
    {!started ? <ActionButton onClick={() => setStarted(true)}>Load source events</ActionButton> : query.isPending ? <p role="status">Loading source events…</p> : query.isError ? <>
      <p role="status">Source events unavailable. No reports are shown.</p><ActionButton onClick={refresh}>Retry source events</ActionButton>
    </> : <>
      <Toolbar><ActionButton onClick={refresh}>Refresh snapshot</ActionButton><span className={styles.note}>{rows.length} reports loaded · through node sequence {last!.through}</span></Toolbar>
      {rows.length === 0 && <p>No source reports were recorded for this session in this retained snapshot.</p>}
      <ol className={styles.list} aria-label="Recorded source events">{rows.map(row => <li key={row.id} data-gap={row.kind === "gap" || undefined}>
        <strong>{row.label}</strong>
        <p className={styles.note}>Reported <time dateTime={date(row.observedAt)}>{date(row.observedAt)}</time></p>
        <span className={styles.note}>{row.accounting}</span>
        {row.kind === "usage" && <p className={styles.note}>Historical accounting disposition; later corrections may supersede it. Session usage shows the current recorded projection.</p>}
        <details><summary>Source and identifiers</summary><DetailList>
          <dt>Source</dt><dd>{row.source.kind.replaceAll("_", " ")} · generation {row.source.generation}</dd>
          <dt>Source record</dt><dd>{row.raw}</dd>
          <dt>Cursor</dt><dd>{row.source.cursor}</dd>
          <dt>Parser</dt><dd>{row.source.parser.id} · {row.source.parser.version}<br />{row.source.parser.digest}</dd>
          <dt>Recorded</dt><dd><time dateTime={date(row.recordedAt)}>{date(row.recordedAt)}</time></dd>
          <dt>Source ID</dt><dd>{row.source.id}</dd><dt>Native session key</dt><dd>{row.source.nativeKey}</dd>
          <dt>Event ID / node sequence</dt><dd>{row.id} · {row.sequence}</dd><dt>Body digest</dt><dd>{row.digest}</dd>
          {row.references.map(ref => <div className={styles.reference} key={ref.label}><dt>{ref.label}</dt><dd>{ref.artifact.id} · {ref.artifact.version}<br />{ref.artifact.digest}</dd></div>)}
        </DetailList></details>
      </li>)}</ol>
      {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage({ cancelRefetch: false })}>Load more source events</ActionButton>}
      {last?.next !== null && !query.hasNextPage && <p className={styles.warning}>Four pages loaded. Additional reports are not shown.</p>}
      <p className={styles.note}>Checked {date(last!.checkedAt)}. A retained snapshot is not proof of a complete transcript; only explicit source gaps are labelled.</p>
    </>}
  </section>;
}
