export const notifyId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const notificationRecipient = notifyId(1);
export function notificationRow(sequence = 1) {
  return { sequence, message: { message_id: notifyId(sequence + 10), revision: 1, scope: { project_id: notifyId(2), workspace_id: notifyId(3) }, recipient_user_id: notificationRecipient,
    summary: `Notification ${sequence}: inspect recorded delivery`, created_at_ms: 1793534400000, expires_at_ms: 1793620800000 }, external_state: "routed" };
}
function deliveryStatus(kind: string) {
  const at = 1793534401000;
  const attempt = { attempt_id: notifyId(70) };
  switch (kind) {
    case "dispatching": return { kind, ...attempt, started_at_ms: at };
    case "accepted_by_transport": return { kind, ...attempt, message_id: "123456789", accepted_at_ms: at };
    case "delivery_unknown": return { kind, ...attempt, since_ms: at };
    case "retry_scheduled": return { kind, next_attempt_ms: at };
    case "permanently_failed": return { kind, reason: "retry_exhausted" };
    case "suppressed": return { kind, reason: "message_expired" };
    default: return { kind };
  }
}

export function notificationDetail(kind = "queued", row = notificationRow()) {
  return { message: row.message, external_state: row.external_state, deliveries: row.external_state === "no_external_route" ? [] : [{ delivery_id: notifyId(50), record_revision: 2, route_id: notifyId(60), route_revision: 1,
    status: deliveryStatus(kind),
    attempts: kind === "queued" ? 0 : 1, duplicate_risk_retries: kind === "delivery_unknown" ? 1 : 0, human_acknowledgment: "unacknowledged", decision: "not_applicable" }] };
}
