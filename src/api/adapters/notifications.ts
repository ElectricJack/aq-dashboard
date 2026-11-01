import { ContractError, isRecord } from "./contract";
export const NOTIFICATION_PAGE_SIZE = 16;
export const NOTIFICATION_MAX_PAGES = 4;
export type NotificationMessage = { id: string; revision: number; recipient: string; project: string; workspace: string; summary: string; created: string; expires: string };
export type NotificationItem = { sequence: number; message: NotificationMessage; routing: "routed" | "no_external_route" };
export type NotificationPage = { items: NotificationItem[]; next: number | null };
export type DeliveryView = { id: string; revision: number; route: string; routeRevision: number; kind: string; label: string; attempts: number; duplicateRiskRetries: number; at?: string; reason?: string; human: string; decision: string };
export type NotificationDetail = { message: NotificationMessage; routing: NotificationItem["routing"]; deliveries: DeliveryView[] };
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid notification inspection response"); }
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function count(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) && value !== "00000000-0000-0000-0000-000000000000"; }
function stamp(value: unknown) { ensure(positive(value) && value <= 8640000000000000); return new Date(value).toISOString(); }
function bounded(raw: unknown) { ensure(JSON.stringify(raw)?.length <= 131072); }
function routing(raw: unknown): NotificationItem["routing"] { ensure(raw === "routed" || raw === "no_external_route"); return raw; }
function message(raw: unknown, recipient: string): NotificationMessage {
  ensure(isRecord(raw) && uuid(raw.message_id) && positive(raw.revision) && raw.recipient_user_id === recipient && uuid(recipient));
  ensure(isRecord(raw.scope) && uuid(raw.scope.project_id) && uuid(raw.scope.workspace_id));
  ensure(typeof raw.summary === "string" && raw.summary.trim().length > 0 && raw.summary.length <= 1600 && new TextEncoder().encode(raw.summary).length <= 4096 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(raw.summary));
  const created = stamp(raw.created_at_ms), expires = stamp(raw.expires_at_ms);
  ensure((raw.expires_at_ms as number) > (raw.created_at_ms as number) && (raw.expires_at_ms as number) - (raw.created_at_ms as number) <= 604800000);
  return { id: raw.message_id, revision: raw.revision, recipient, project: raw.scope.project_id, workspace: raw.scope.workspace_id, summary: raw.summary, created, expires };
}
export function adaptNotificationPage(raw: unknown, recipient: string, after: number): NotificationPage {
  bounded(raw); ensure(isRecord(raw) && Array.isArray(raw.items) && raw.items.length <= NOTIFICATION_PAGE_SIZE && (raw.next_after === null || positive(raw.next_after)));
  let previous = after; const ids = new Set<string>();
  const items = raw.items.map(row => {
    ensure(isRecord(row) && positive(row.sequence) && row.sequence > previous);
    const m = message(row.message, recipient); ensure(!ids.has(m.id)); ids.add(m.id); previous = row.sequence;
    return { sequence: row.sequence, message: m, routing: routing(row.external_state) };
  });
  ensure(raw.next_after === null || (items.length === NOTIFICATION_PAGE_SIZE && raw.next_after === previous));
  return { items, next: raw.next_after as number | null };
}
export function mergeNotificationPages(pages: NotificationPage[]): NotificationItem[] {
  ensure(pages.length <= NOTIFICATION_MAX_PAGES); const rows: NotificationItem[] = [], ids = new Set<string>(); let previous = 0;
  for (const page of pages) for (const row of page.items) { ensure(row.sequence > previous && !ids.has(row.message.id)); previous = row.sequence; ids.add(row.message.id); rows.push(row); }
  return rows;
}
const LABELS: Record<string, string> = { queued: "Queued", dispatching: "Dispatch in progress", accepted_by_transport: "Accepted by transport", delivery_unknown: "Delivery unknown", retry_scheduled: "Retry scheduled", permanently_failed: "Permanently failed", suppressed: "Suppressed" };
const REASONS: Record<string, string> = { invalid_payload: "Invalid payload", destination_unavailable: "Destination unavailable", retry_exhausted: "Retry budget exhausted", provider_delay_too_long: "Provider delay too long", scope_revoked: "Scope revoked", route_changed: "Route changed", message_expired: "Message expired" };
export function adaptNotificationDetail(raw: unknown, expected: NotificationItem): NotificationDetail {
  bounded(raw); ensure(isRecord(raw) && Array.isArray(raw.deliveries) && raw.deliveries.length <= 8);
  const m = message(raw.message, expected.message.recipient); ensure(JSON.stringify(m) === JSON.stringify(expected.message));
  const route = routing(raw.external_state); ensure(route === expected.routing && (route === "routed") === (raw.deliveries.length > 0)); const ids = new Set<string>();
  const deliveries = raw.deliveries.map(row => {
    ensure(isRecord(row) && uuid(row.delivery_id) && positive(row.record_revision) && uuid(row.route_id) && positive(row.route_revision));
    ensure(!ids.has(row.delivery_id)); ids.add(row.delivery_id);
    ensure(count(row.attempts) && count(row.duplicate_risk_retries) && isRecord(row.status) && typeof row.status.kind === "string" && row.status.kind.length <= 64);
    ensure(typeof row.human_acknowledgment === "string" && row.human_acknowledgment.length <= 64 && typeof row.decision === "string" && row.decision.length <= 64);
    const kind = row.status.kind; let at: string | undefined;
    if (["dispatching", "accepted_by_transport", "delivery_unknown"].includes(kind)) ensure(uuid(row.status.attempt_id));
    if (kind === "accepted_by_transport") { ensure(typeof row.status.message_id === "string" && row.status.message_id.length > 0 && row.status.message_id.length <= 128); at = stamp(row.status.accepted_at_ms); }
    if (kind === "dispatching") at = stamp(row.status.started_at_ms);
    if (kind === "delivery_unknown") at = stamp(row.status.since_ms);
    if (kind === "retry_scheduled") at = stamp(row.status.next_attempt_ms);
    if (["permanently_failed", "suppressed"].includes(kind)) ensure(typeof row.status.reason === "string" && row.status.reason.length <= 64);
    return { id: row.delivery_id, revision: row.record_revision, route: row.route_id, routeRevision: row.route_revision, kind, label: LABELS[kind] ?? "Unsupported delivery status", attempts: row.attempts, duplicateRiskRetries: row.duplicate_risk_retries, at,
      reason: typeof row.status.reason === "string" ? REASONS[row.status.reason] ?? "Unknown reason" : undefined,
      human: row.human_acknowledgment === "unacknowledged" ? "Not acknowledged" : "Unsupported acknowledgment status", decision: row.decision === "not_applicable" ? "No decision attached" : "Unsupported decision status" };
  });
  return { message: m, routing: route, deliveries };
}
