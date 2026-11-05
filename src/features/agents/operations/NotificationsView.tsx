import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adaptNotificationDetail, adaptNotificationPage, NOTIFICATION_PAGE_SIZE, type DeliveryView, type NotificationItem } from "../../../api/adapters/notifications";
import { ApiError, apiGet, apiSend } from "../../../api/client";
import { isRecord } from "../../../api/adapters/contract";
import { queryKey } from "../../../api/queryKeys";
import { useSession } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import type { SessionDetailView } from "../../../api/adapters/inspection";
import styles from "./Operations.module.css";

/** U14: this project's notifications for the current account, read only while this view is open.
 * Message, route, attempts, transport receipt, delivery state and acknowledgment are separate facts. */
export function NotificationsView({ session: s }: { session: SessionDetailView }) {
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability("notifications.read");
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: queryKey(queryContext, "session-notifications", { project: s.project.id }), enabled: capability.enabled, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptNotificationPage(await apiGet<unknown>(`/api/notifications?after=0&limit=${NOTIFICATION_PAGE_SIZE}`, signal), queryContext.principalId, 0) });
  const rows = query.data?.items.filter(r => r.message.project === s.project.id) ?? [];
  const item = rows.find(r => r.message.id === selected);
  return <section aria-label="Notifications" className={styles.view}>
    <h3>Notifications</h3>
    {!capability.enabled ? <p>Notifications unavailable{capability.reason ? `: ${capability.reason}` : ""}</p>
      : query.isError || !query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="notifications" onRetry={() => void query.refetch()} />
      : rows.length === 0 ? <p>No notifications for this project in your first {NOTIFICATION_PAGE_SIZE} messages.</p> : <>
        <ul aria-label="Project notifications" className={styles.list}>{rows.map(r => <li key={r.message.id}>
          <button type="button" aria-pressed={selected === r.message.id} onClick={() => setSelected(r.message.id)}>
            <strong>{r.message.summary.trim().split("\n")[0]!.slice(0, 160)}</strong>
            <span className={styles.muted}><time dateTime={r.message.created}>{r.message.created}</time> · {r.routing === "routed" ? "External route configured" : "No external route"}</span>
          </button>
        </li>)}</ul>
        {query.data.next !== null && <p className={styles.muted}>Showing this project's notifications from your first {NOTIFICATION_PAGE_SIZE} messages. The full inbox is in Settings.</p>}
        {item && <NotificationDeliveries key={`${item.message.id}:${item.message.revision}`} item={item} />}
      </>}
  </section>;
}

function NotificationDeliveries({ item }: { item: NotificationItem }) {
  const { queryContext } = useSession();
  const key = queryKey(queryContext, "session-notification-detail", { id: item.message.id, revision: item.message.revision });
  const query = useQuery({ queryKey: key, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptNotificationDetail(await apiGet<unknown>(`/api/notifications/${encodeURIComponent(item.message.id)}`, signal), item) });
  if (query.isError || !query.data) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this notification" onRetry={() => void query.refetch()} />;
  return <div className={styles.detail}>
    <p>{query.data.message.summary}</p>
    {query.data.deliveries.length === 0 ? <p>No external route recorded for this message</p>
      : query.data.deliveries.map(d => <Delivery key={d.id} delivery={d} queryKeyValue={key} />)}
  </div>;
}

type RetryResult = { kind: "queued"; text: string } | { kind: "error"; text: string };
function Delivery({ delivery: d, queryKeyValue }: { delivery: DeliveryView; queryKeyValue: readonly unknown[] }) {
  const client = useQueryClient();
  const ops = useRef(new Map<string, string>());
  const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RetryResult | null>(null);
  // One operation id per delivery revision: a repeated confirm after an unknown outcome is the same retry.
  const opKey = `${d.id}:${d.revision}`;
  if (!ops.current.has(opKey)) ops.current.set(opKey, crypto.randomUUID());
  async function retry() {
    setBusy(true);
    try {
      const raw = await apiSend<unknown>("POST", "/api/notifications/retry", { operation_id: ops.current.get(opKey), delivery_id: d.id, expected_revision: d.revision, accept_duplicate_risk: true });
      const retries = isRecord(raw) && typeof raw.duplicate_risk_retries === "number" ? raw.duplicate_risk_retries : null;
      setResult({ kind: "queued", text: `Retry recorded. Possible duplicate: the earlier attempt may also have been delivered${retries !== null ? ` (duplicate-risk retries: ${retries})` : ""}.` });
      setConfirming(false); setAccepted(false);
      void client.invalidateQueries({ queryKey: queryKeyValue });
    } catch (error) {
      setResult({ kind: "error", text: error instanceof ApiError && error.status === 409 ? "Not retried: the delivery revision or route changed. Refresh before retrying."
        : error instanceof ApiError && error.effectUnknown ? "Retry outcome unknown. Confirming again repeats the same retry operation." : "Not retried: AQ rejected the retry." });
    } finally { setBusy(false); }
  }
  return <section role="group" aria-label={`Delivery ${d.id}`} className={styles.status} data-kind={d.kind === "delivery_unknown" || d.kind === "permanently_failed" ? "unknown" : d.kind}>
    <strong>{d.label}</strong>
    {d.reason && <span>{d.reason}</span>}
    {d.at && <span className={styles.muted}>Recorded <time dateTime={d.at}>{d.at}</time></span>}
    <span>Route {d.route.slice(0, 8)} · revision {d.routeRevision}</span>
    <span>Attempts: {d.attempts} · Duplicate-risk retries: {d.duplicateRiskRetries}</span>
    <span>{d.receipt ? `Transport receipt: ${d.receipt}` : "Transport receipt: none recorded"}</span>
    <span>{d.human} · {d.decision}</span>
    {d.kind === "delivery_unknown" && (!confirming ? <ActionButton onClick={() => setConfirming(true)}>Retry delivery</ActionButton> : <div className={styles.confirm}>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />I understand a retry may deliver a duplicate message.</label>
      <div className={styles.row}><ActionButton disabled={!accepted || busy} onClick={() => void retry()}>Confirm retry</ActionButton><ActionButton onClick={() => { setConfirming(false); setAccepted(false); }}>Cancel</ActionButton></div>
    </div>)}
    {result && <span role="status">{result.text}</span>}
  </section>;
}
