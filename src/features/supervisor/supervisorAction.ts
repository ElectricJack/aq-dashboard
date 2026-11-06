import { ApiError } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { supervisorDigest, supervisorId, type FrozenSupervisorMessage } from "../../api/adapters/supervisor";
import { supervisorRequest } from "../../api/supervisorClient";
import type { ActionOperation } from "../actions/actionClient";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function supervisorActionBytes(intent: FrozenSupervisorMessage): string {
  return canonical({ operation_id: intent.operation, kind: "supervisor.message.send", subject: { type: "conversation", id: intent.conversation, revision: intent.revision }, expected_versions: { conversation: intent.revision }, payload: JSON.parse(intent.bytes) });
}
export async function supervisorAction(kind: "post" | "lookup", conversation: string, operation: string, message: string, signal: AbortSignal, intent?: FrozenSupervisorMessage): Promise<ActionOperation> {
  const bytes = intent ? supervisorActionBytes(intent) : undefined;
  const raw = await supervisorRequest(kind === "post" ? "POST" : "GET", kind === "post" ? "/api/v1/actions" : `/api/v1/operations/${operation}`, signal, kind === "post" ? bytes : undefined);
  if (!isRecord(raw) || raw.api_version !== "dashboard-actions-1" || !isRecord(raw.data)) throw new ContractError("Invalid supervisor action response");
  const value = raw.data;
  const revision = (v: unknown) => typeof v === "string" && /^[1-9][0-9]{0,39}$/.test(v);
  const refs = (v: unknown): v is { type: string; id: string; revision?: string }[] => Array.isArray(v) && v.length <= 100 && v.every(ref => isRecord(ref) && typeof ref.type === "string" && supervisorId(ref.id) && (ref.revision === undefined || ref.revision === null || revision(ref.revision)));
  if (value.operation_id !== operation || !["pending", "confirmed", "conflict", "rejected", "unknown"].includes(String(value.disposition)) ||
      !isRecord(value.scope) || value.scope.kind !== "all_authorized" ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) || typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at)) ||
      !refs(value.subject_refs) || value.subject_refs.length !== 1 || value.subject_refs[0]?.type !== "conversation" || value.subject_refs[0]?.id !== conversation || (intent && value.subject_refs[0]?.revision !== intent.revision) ||
      !refs(value.receipt_refs) || !refs(value.affected_entities) || typeof value.request_digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.request_digest) ||
      (bytes && value.request_digest !== await supervisorDigest(canonical({ request: JSON.parse(bytes), scope: value.scope }))) ||
      !["none", "lookup_original", "refresh_and_review"].includes(String(value.recovery))) throw new ContractError("Supervisor action identity changed");
  if (value.disposition === "confirmed" && (!value.receipt_refs.some(ref => ref.type === "mailbox_operation" && ref.id === operation) || !value.affected_entities.some(ref => ref.type === "message" && ref.id === message))) throw new ContractError("Supervisor enqueue evidence missing");
  return value as unknown as ActionOperation;
}
export function supervisorActionError(error: unknown): string {
  // A 403 refuses this one request before admission; it is not a sign-out (QA §2A).
  if (error instanceof ApiError && error.status === 403) return `Not sent: AQ refused this request.${error.envelope?.message ? ` ${error.envelope.message}.` : ""} Your draft is preserved.`;
  return error instanceof ApiError && error.status === 404 ? "No receipt is available yet. The original request may still finish; its status remains unknown." : "Message status is unknown. Keep this operation and check its status or retry the exact original request.";
}
