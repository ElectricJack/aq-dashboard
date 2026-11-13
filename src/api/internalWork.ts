import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

export const INTERNAL_WORK_PURPOSES = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"] as const;
export type InternalWorkPurpose = typeof INTERNAL_WORK_PURPOSES[number];
export type InternalWorkSettings = {
  revision: string; catalog_revision: string; default_profile_id: string | null;
  overrides: Partial<Record<InternalWorkPurpose, string>>; purposes: InternalWorkPurpose[];
};
export type SaveInternalWork = Pick<InternalWorkSettings, "default_profile_id" | "overrides"> & { operation_id: string; expected_revision: string; expected_catalog_revision: string };
export type InternalWorkSaved = InternalWorkSettings & { operation_id: string; disposition: "saved" | "unchanged" };
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
const profileId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const purpose = (value: unknown): value is InternalWorkPurpose => INTERNAL_WORK_PURPOSES.includes(value as InternalWorkPurpose);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid internal work settings response"); }
export function adaptInternalWork(value: unknown): InternalWorkSettings {
  ensure(isRecord(value) && revision(value.revision) && revision(value.catalog_revision));
  ensure(value.default_profile_id === null || profileId(value.default_profile_id));
  ensure(isRecord(value.overrides) && Array.isArray(value.purposes) && value.purposes.length <= INTERNAL_WORK_PURPOSES.length && value.purposes.every(purpose));
  const overrides: Partial<Record<InternalWorkPurpose, string>> = {};
  for (const [key, id] of Object.entries(value.overrides)) { ensure(purpose(key) && profileId(id)); overrides[key] = id; }
  return { revision: value.revision, catalog_revision: value.catalog_revision, default_profile_id: value.default_profile_id as string | null, overrides, purposes: value.purposes as InternalWorkPurpose[] };
}
function saved(value: unknown, operationId: string): InternalWorkSaved {
  ensure(isRecord(value) && value.operation_id === operationId && (value.disposition === "saved" || value.disposition === "unchanged"));
  return { ...adaptInternalWork(value), operation_id: operationId, disposition: value.disposition };
}
export async function readInternalWorkSettings(signal?: AbortSignal) { return adaptInternalWork(await apiGet<unknown>("/api/settings/internal-work", signal)); }
export async function saveInternalWorkSettings(request: SaveInternalWork) { return saved(await apiSend<unknown>("POST", "/api/settings/internal-work", request), request.operation_id); }
export async function inspectInternalWorkSave(operationId: string) { return saved(await apiGet<unknown>(`/api/settings/internal-work/operations/${encodeURIComponent(operationId)}`), operationId); }

const RUN_STATUSES = ["queued", "running", "answered", "failed"] as const;
export type InternalRunStatus = typeof RUN_STATUSES[number];
export type InternalRunAttempt = { provider: string; model: string; way: "api" | "login"; reason: string | null; detail: string; elapsed_ms: number };
export type InternalRunData = {
  id: string; purpose: InternalWorkPurpose; status: InternalRunStatus;
  affected: { kind: string; id: string; project_id: string | null };
  instructions: string; input: string; answer?: unknown; reason?: string; detail?: string; attempts: InternalRunAttempt[];
  provider?: string; model?: string; way?: "api" | "login"; elapsed_ms?: number; usage?: { input_tokens: number; output_tokens: number };
  created_at_ms: number; finished_at_ms?: number; escalation: "none" | "supervisor" | "owner" | "resolved"; diagnosis?: string; retry_of?: string;
};
export type InternalRunPage = { runs: InternalRunData[]; next_cursor: string | null };
export type InternalRunQuery = { affected_kind?: string; affected_id?: string; purpose?: InternalWorkPurpose; status?: InternalRunStatus; cursor?: string; limit?: number };
const text = (value: unknown): value is string => typeof value === "string";
const optionalText = (value: unknown) => value === undefined || text(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const optionalCount = (value: unknown) => value === undefined || count(value);
const uuid = (value: unknown): value is string => text(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const OPTIONAL_RUN_FIELDS = ["answer", "reason", "detail", "provider", "model", "way", "elapsed_ms", "usage", "finished_at_ms", "diagnosis", "retry_of"] as const;
const WAYS = ["api", "login"];
function runEnsure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid internal work run response"); }
function attempt(value: unknown): InternalRunAttempt {
  runEnsure(isRecord(value) && text(value.provider) && text(value.model) && WAYS.includes(String(value.way)) && (value.reason === null || text(value.reason)) && text(value.detail) && count(value.elapsed_ms));
  return { provider: value.provider, model: value.model, way: value.way as "api" | "login", reason: value.reason, detail: value.detail, elapsed_ms: value.elapsed_ms };
}
export function adaptInternalRun(value: unknown): InternalRunData {
  runEnsure(isRecord(value) && uuid(value.id) && purpose(value.purpose) && RUN_STATUSES.includes(value.status as InternalRunStatus));
  runEnsure(isRecord(value.affected) && text(value.affected.kind) && text(value.affected.id) && (value.affected.project_id === null || uuid(value.affected.project_id)));
  runEnsure(text(value.instructions) && text(value.input) && Array.isArray(value.attempts) && value.attempts.length <= 64);
  runEnsure(optionalText(value.reason) && optionalText(value.detail) && optionalText(value.provider) && optionalText(value.model) && optionalText(value.diagnosis));
  runEnsure(value.way === undefined || WAYS.includes(String(value.way)));
  runEnsure(optionalCount(value.elapsed_ms) && optionalCount(value.finished_at_ms) && count(value.created_at_ms));
  runEnsure(value.usage === undefined || (isRecord(value.usage) && count(value.usage.input_tokens) && count(value.usage.output_tokens)));
  runEnsure(["none", "supervisor", "owner", "resolved"].includes(String(value.escalation)) && (value.retry_of === undefined || uuid(value.retry_of)));
  const affected = value.affected as InternalRunData["affected"], known = value as unknown as InternalRunData;
  const optional = Object.fromEntries(OPTIONAL_RUN_FIELDS.filter(key => known[key] !== undefined).map(key => [key, known[key]]));
  return {
    ...optional, id: known.id, purpose: known.purpose, status: known.status, affected: { kind: affected.kind, id: affected.id, project_id: affected.project_id },
    instructions: known.instructions, input: known.input, attempts: value.attempts.map(attempt), created_at_ms: known.created_at_ms, escalation: known.escalation,
  };
}
function runsUrl(params: InternalRunQuery) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return `/api/internal-work/runs${query.size ? `?${query}` : ""}`;
}
export async function listInternalRuns(params: InternalRunQuery, signal?: AbortSignal): Promise<InternalRunPage> {
  const value = await apiGet<unknown>(runsUrl(params), signal);
  runEnsure(isRecord(value) && Array.isArray(value.runs) && value.runs.length <= 100 && (value.next_cursor === null || text(value.next_cursor)));
  return { runs: value.runs.map(adaptInternalRun), next_cursor: value.next_cursor as string | null };
}
export async function readInternalRun(id: string, signal?: AbortSignal) { return adaptInternalRun(await apiGet<unknown>(`/api/internal-work/runs/${encodeURIComponent(id)}`, signal)); }
export async function retryInternalRun(id: string): Promise<{ id: string }> {
  const value = await apiSend<unknown>("POST", `/api/internal-work/runs/${encodeURIComponent(id)}/retry`, undefined);
  runEnsure(isRecord(value) && uuid(value.id));
  return { id: value.id };
}
