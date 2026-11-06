import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { adaptNotificationDetail, adaptNotificationPage, mergeNotificationPages, NOTIFICATION_MAX_PAGES, NOTIFICATION_PAGE_SIZE, type NotificationItem } from "../../api/adapters/notifications";
import { useSession } from "../../app/session";
import { ActionButton, DetailList, Panel, Toolbar } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { Timestamp } from "../settings/Timestamp";
import styles from "./Notifications.module.css";

export function Notifications({ className }: { className?: string }) {
  const { queryContext } = useSession();
  return <Inbox key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${queryContext.contractVersion}`} className={className} />;
}
function Inbox({ className }: { className?: string | undefined }) {
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability("notifications.read");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selected) { lastSelected.current = selected; return; }
    if (lastSelected.current) list.current?.querySelector<HTMLButtonElement>(`button[data-message-id="${CSS.escape(lastSelected.current)}"]`)?.focus();
  }, [selected]);
  const query = useInfiniteQuery({
    queryKey: queryKey(queryContext, "notification-inbox", {}), enabled: capability.enabled,
    initialPageParam: 0, queryFn: async ({ pageParam, signal }) => adaptNotificationPage(await apiGet<unknown>(`/api/notifications?after=${pageParam}&limit=${NOTIFICATION_PAGE_SIZE}`, signal), queryContext.principalId, pageParam),
    getNextPageParam: (last, pages) => pages.length < NOTIFICATION_MAX_PAGES ? last.next ?? undefined : undefined,
    retry: false, refetchOnWindowFocus: false,
  });
  let rows: NotificationItem[] = [], pageError: unknown;
  try { rows = mergeNotificationPages(query.data?.pages ?? []); } catch (e) { pageError = e; }
  const item = rows.find(row => row.message.id === selected);
  return <div className={`${styles.section} ${className ?? ""}`}><Panel title="Your notifications" description="Messages addressed to this account and their recorded delivery status."
    actions={capability.enabled && <ActionButton disabled={query.isFetching} onClick={() => { setSelected(null); void query.refetch(); }}>Refresh inbox</ActionButton>}>
    {!capability.enabled ? <p>{capability.reason}</p> : query.isError || pageError || !query.data ? <QueryStatus status={query.isError || pageError ? "error" : "pending"} error={pageError ?? query.error} label="notifications" onRetry={() => void query.refetch()} /> : <>
      <p className={styles.meta}>Current account · oldest first</p>
      {rows.length === 0 ? <p>No notifications in this inbox.</p> : <div className={styles.panes} data-selected={!!item}>
        <div><ul ref={list} className={styles.messages} aria-label="Notification inbox">{rows.map(row => <li key={row.message.id}><button type="button" data-message-id={row.message.id} aria-pressed={selected === row.message.id} className={styles.message} onClick={() => setSelected(row.message.id)}>
          <strong>{row.message.summary.trim().split("\n")[0]!.slice(0, 160)}</strong>
          <span className={styles.meta}><Timestamp iso={row.message.created} /></span>
          <span className={styles.meta}>{row.routing === "routed" ? "External route configured" : "No external route"}</span>
        </button></li>)}</ul>
        {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more notifications</ActionButton>}
        {query.data.pages.length === NOTIFICATION_MAX_PAGES && query.data.pages.at(-1)?.next && <p className={styles.meta}>Showing the first 64 notifications.</p>}
        </div>
        {item ? <NotificationDetail key={`${item.message.id}:${item.message.revision}`} item={item} onBack={() => setSelected(null)} /> : <section className={styles.empty}><h3>Delivery details</h3><p>Select a notification to inspect its recorded delivery.</p></section>}
      </div>}
    </>}
  </Panel></div>;
}
function NotificationDetail({ item, onBack }: { item: NotificationItem; onBack(): void }) {
  const { queryContext } = useSession();
  const query = useQuery({ queryKey: queryKey(queryContext, "notification-detail", { id: item.message.id, revision: item.message.revision }), retry: false,
    queryFn: async ({ signal }) => adaptNotificationDetail(await apiGet<unknown>(`/api/notifications/${encodeURIComponent(item.message.id)}`, signal), item) });
  return <section className={styles.detail} aria-label="Notification delivery details">
    <Toolbar><ActionButton className={styles.back} onClick={onBack}>Back to inbox</ActionButton><h3>Delivery details</h3><ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh delivery</ActionButton></Toolbar>
    {query.isError || !query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this notification" onRetry={() => void query.refetch()} /> : <>
      <p className={styles.summary}>{query.data.message.summary}</p>
      {query.data.deliveries.length === 0 ? <p>No external route was recorded for this message.</p> : <>
        <p className={styles.meta}>Transport acceptance, human acknowledgment and a human decision are separate.</p>
        <ul className={styles.deliveries} aria-label="Recorded deliveries">{query.data.deliveries.map(d => <li key={d.id} data-delivery-id={d.id} data-status={d.kind}><h4>{d.label}</h4>
          {d.reason && <p>{d.reason}</p>}{d.at && <p className={styles.meta}>Recorded time <Timestamp iso={d.at} /></p>}
          <p>{d.human} · {d.decision}</p>
          <p className={styles.meta}>Attempts: {d.attempts} · Duplicate-risk retries: {d.duplicateRiskRetries}</p>
          {d.kind === "delivery_unknown" && <p>External receipt is uncertain.</p>}
        </li>)}</ul>
      </>}
      <details><summary>Message identifiers and expiry</summary><DetailList><dt>Message ID</dt><dd>{query.data.message.id}</dd><dt>Revision</dt><dd>{query.data.message.revision}</dd><dt>Project ID</dt><dd>{query.data.message.project}</dd><dt>Workspace ID</dt><dd>{query.data.message.workspace}</dd><dt>Recipient</dt><dd>{query.data.message.recipient}</dd><dt>Created</dt><dd><Timestamp iso={query.data.message.created} /></dd><dt>Message expiry</dt><dd><Timestamp iso={query.data.message.expires} /></dd></DetailList></details>
    </>}
  </section>;
}
