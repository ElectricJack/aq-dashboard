import { createHash } from "node:crypto";
import type { Discovery, History, Receipt, SupervisorMessage } from "../api/adapters/supervisor";
export const supervisorId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const supervisorActor = supervisorId(4);
export const supervisorDiscovery: Discovery = { contract: "human-supervisor-conversation-1", conversation: { id: supervisorId(1), revision: "1", label: "Global supervisor" },
  runtime: { state: "unavailable", binding: null, reason: "central_runtime_not_connected" }, limits: { body_bytes: 16384, context_refs: 16, attachments: 4, history_page: 16 } };
export const textDigest = (body: string) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
export function supervisorMessage(cursor = 1, body = `Retained human message ${cursor}`): SupervisorMessage {
  return { message_id: supervisorId(100 + cursor), thread_id: supervisorId(1), conversation_id: supervisorId(1), cursor: String(cursor), author: { kind: "human", user_id: supervisorActor },
    body, body_digest: textDigest(body), created_at_ms: 1793511000000 + cursor, logical_admission: "queued", host_delivery: "not_attempted", agent_receipt: null };
}
export function supervisorHistory(items: SupervisorMessage[] = [], options: Partial<History> = {}): History {
  return { contract: supervisorDiscovery.contract, conversation: supervisorDiscovery.conversation, runtime: supervisorDiscovery.runtime, direction: "backward", through_cursor: items.at(-1)?.cursor ?? "0", items, has_more: false, next_cursor: null, ...options };
}
export function supervisorReceipt(bytes: string, state: Receipt["state"] = "queued"): Receipt {
  const request = JSON.parse(bytes) as { operation_id: string; message_id: string; body: string };
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(bytes)).sort(([a], [b]) => a.localeCompare(b))));
  return { contract: supervisorDiscovery.contract, conversation: supervisorDiscovery.conversation, runtime: { state: "unavailable", binding: null, reason: "central_runtime_not_connected" }, operation_id: request.operation_id, message_id: request.message_id, actor_id: supervisorActor,
    request_digest: textDigest(canonical), body_digest: textDigest(request.body), state, cursor: state === "queued" ? "1" : null, reason: state === "queued" ? null : "conversation_revision_changed", host_delivery: "not_attempted", agent_receipt: null };
}

/** Labelled G1b fixture; confirmation proves enqueue only. */
export function supervisorActionReceipt(bytes: string, disposition = "confirmed") {
  const request = JSON.parse(bytes);
  return { api_version: "dashboard-actions-1", data: {
    operation_id: request.operation_id, disposition, request_digest: textDigest(JSON.stringify(sortKeys({ request, scope: { kind: "all_authorized" } }))), scope: { kind: "all_authorized" },
    created_at: "2026-11-03T00:00:00Z", updated_at: "2026-11-03T00:00:00Z",
    subject_refs: [request.subject], receipt_refs: disposition === "confirmed" ? [{ type: "mailbox_operation", id: request.operation_id }] : [],
    affected_entities: disposition === "confirmed" ? [{ type: "message", id: request.payload.message_id, revision: "1" }] : [], recovery: disposition === "pending" || disposition === "unknown" ? "lookup_original" : disposition === "confirmed" ? "none" : "refresh_and_review",
  } };
}
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  return value;
}
export function supervisorReply(anchor = 1, reply = 1, body = "The supervisor replied to your message."): SupervisorMessage {
  return { ...supervisorMessage(500 + reply, body), cursor: `${anchor}.${reply}`, author: { kind: "supervisor", actor_id: supervisorId(7), generation: 1, session_id: supervisorId(8) },
    dispatch: { dispatch_id: supervisorId(9), host_operation_id: supervisorId(10), batch_digest: "a".repeat(64) } } as SupervisorMessage;
}
