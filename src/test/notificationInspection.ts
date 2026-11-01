export const notifyId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const notificationRecipient = notifyId(1);
export function notificationRow(sequence = 1) {
  return { sequence, message: { message_id: notifyId(sequence + 10), revision: 1, scope: { project_id: notifyId(2), workspace_id: notifyId(3) }, recipient_user_id: notificationRecipient,
    summary: `Notification ${sequence}: inspect recorded delivery`, created_at_ms: 1793534400000, expires_at_ms: 1793620800000 }, external_state: "routed" };
}
export function notificationDetail(kind = "queued", row = notificationRow()) {
  return { message: row.message, external_state: row.external_state, deliveries: row.external_state === "no_external_route" ? [] : [{ delivery_id: notifyId(50), record_revision: 2, route_id: notifyId(60), route_revision: 1,
    status: { kind, ...(["dispatching", "accepted_by_transport", "delivery_unknown"].includes(kind) ? { attempt_id: notifyId(70) } : {}),
      ...(kind === "dispatching" ? { started_at_ms: 1793534401000 } : {}), ...(kind === "accepted_by_transport" ? { message_id: "123456789", accepted_at_ms: 1793534401000 } : {}),
      ...(kind === "delivery_unknown" ? { since_ms: 1793534401000 } : {}), ...(kind === "retry_scheduled" ? { next_attempt_ms: 1793534401000 } : {}),
      ...(kind === "permanently_failed" ? { reason: "retry_exhausted" } : {}), ...(kind === "suppressed" ? { reason: "message_expired" } : {}) },
    attempts: kind === "queued" ? 0 : 1, duplicate_risk_retries: kind === "delivery_unknown" ? 1 : 0, human_acknowledgment: "unacknowledged", decision: "not_applicable" }] };
}
