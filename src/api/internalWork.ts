import { apiGet, apiSend } from "./client";
import { boundedList, ContractError, isRecord, nullable, optional as optionalField } from "./adapters/contract";

export const INTERNAL_WORK_PURPOSES = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"] as const;
export type InternalWorkPurpose = typeof INTERNAL_WORK_PURPOSES[number];
export type InternalWorkSettings = {
  revision: string; default_profile_id: string | null;
  overrides: Partial<Record<InternalWorkPurpose, string>>; purposes: InternalWorkPurpose[];
  /** Saved choices whose level no longer exists; `purpose` is null for the default. Such a purpose runs on the default. */
  missing: { purpose: InternalWorkPurpose | null; profile_id: string }[];
};
export type SaveInternalWork = Pick<InternalWorkSettings, "default_profile_id" | "overrides"> & { operation_id: string; expected_revision: string };
export type InternalWorkSaved = InternalWorkSettings & { operation_id: string; disposition: "saved" | "unchanged" };
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
const profileId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const purpose = (value: unknown): value is InternalWorkPurpose => INTERNAL_WORK_PURPOSES.includes(value as InternalWorkPurpose);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid internal work settings response"); }
export function adaptInternalWork(value: unknown): InternalWorkSettings {
  ensure(isRecord(value));
  ensure(revision(value.revision));
  ensure(nullable(value.default_profile_id, profileId));
  ensure(isRecord(value.overrides));
  ensure(boundedList(value.purposes, INTERNAL_WORK_PURPOSES.length, purpose));
  const overrides: Partial<Record<InternalWorkPurpose, string>> = {};
  for (const [key, id] of Object.entries(value.overrides)) { ensure(purpose(key) && profileId(id)); overrides[key] = id; }
  // `missing` came with levels as documents (aq-server spec 0014); a server without it reports none.
  ensure(value.missing === undefined || (Array.isArray(value.missing) && value.missing.length <= INTERNAL_WORK_PURPOSES.length + 1));
  const missing = (value.missing ?? []).map((item: unknown) => {
    ensure(isRecord(item));
    ensure(nullable(item.purpose, purpose));
    ensure(profileId(item.profile_id));
    return { purpose: item.purpose, profile_id: item.profile_id };
  });
  return { revision: value.revision, default_profile_id: value.default_profile_id, overrides, purposes: value.purposes as InternalWorkPurpose[], missing };
}
function saved(value: unknown, operationId: string): InternalWorkSaved {
  ensure(isRecord(value));
  ensure(value.operation_id === operationId);
  ensure(value.disposition === "saved" || value.disposition === "unchanged");
  return { ...adaptInternalWork(value), operation_id: operationId, disposition: value.disposition };
}
export async function readInternalWorkSettings(signal?: AbortSignal) { return adaptInternalWork(await apiGet<unknown>("/api/settings/internal-work", signal)); }
export async function saveInternalWorkSettings(request: SaveInternalWork) { return saved(await apiSend<unknown>("POST", "/api/settings/internal-work", request), request.operation_id); }
export async function inspectInternalWorkSave(operationId: string) { return saved(await apiGet<unknown>(`/api/settings/internal-work/operations/${encodeURIComponent(operationId)}`), operationId); }

const RUN_STATUSES = ["queued", "running", "answered", "failed"] as const;
export type InternalRunStatus = typeof RUN_STATUSES[number];
export type InternalRunAttempt = { provider: string; model: string; way: "api" | "login"; reason: string | null; detail: string; elapsed_ms: number };
/** One step of an agent's transcript. Texts are server-clipped (to 2 KiB) and redacted already; `clipped` marks an item the server cut. */
export type TranscriptItem =
  | { kind: "text" | "error"; text: string; clipped?: boolean }
  | { kind: "tool"; tool: string; input: string; clipped?: boolean }
  | { kind: "result"; output: string; error: boolean; clipped?: boolean }
  | { kind: "clipped" }
  | { kind: "unknown" };
export type InternalRunTranscript = { candidate_index: number; events: TranscriptItem[]; /** Items past the bound, not kept. */ omitted: number };
export const TRANSCRIPT_MAX_ITEMS = 2000, TRANSCRIPT_MAX_TRANSCRIPTS = 64, TRANSCRIPT_TEXT_CHARS = 4096;
export type InternalRunData = {
  id: string; purpose: InternalWorkPurpose; status: InternalRunStatus;
  affected: { kind: string; id: string; project_id: string | null };
  instructions: string; input: string; answer?: unknown; reason?: string; detail?: string; attempts: InternalRunAttempt[];
  provider?: string; model?: string; way?: "api" | "login"; elapsed_ms?: number; usage?: { input_tokens: number; output_tokens: number };
  created_at_ms: number; finished_at_ms?: number; escalation: "none" | "supervisor" | "owner" | "resolved"; diagnosis?: string; retry_of?: string;
  /** Only the read of one run has them; one per agent candidate. */
  transcripts?: InternalRunTranscript[];
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
  runEnsure(isRecord(value));
  runEnsure(text(value.provider));
  runEnsure(text(value.model));
  runEnsure(WAYS.includes(String(value.way)));
  runEnsure(value.reason === null || text(value.reason));
  runEnsure(text(value.detail));
  runEnsure(count(value.elapsed_ms));
  return { provider: value.provider, model: value.model, way: value.way as "api" | "login", reason: value.reason, detail: value.detail, elapsed_ms: value.elapsed_ms };
}
const clip = (value: string) => value.length > TRANSCRIPT_TEXT_CHARS ? value.slice(0, TRANSCRIPT_TEXT_CHARS) : value;
function transcriptItem(value: unknown): TranscriptItem {
  runEnsure(isRecord(value));
  runEnsure(text(value.kind));
  runEnsure(optionalField(value.clipped, v => typeof v === "boolean"));
  const clipped = value.clipped === true ? { clipped: true } : {};
  switch (value.kind) {
    case "text": case "error": runEnsure(text(value.text)); return { kind: value.kind, text: clip(value.text), ...clipped };
    case "tool": runEnsure(text(value.tool)); runEnsure(text(value.input)); return { kind: "tool", tool: clip(value.tool), input: clip(value.input), ...clipped };
    case "result": runEnsure(text(value.output)); runEnsure(typeof value.error === "boolean"); return { kind: "result", output: clip(value.output), error: value.error, ...clipped };
    case "clipped": return { kind: "clipped" };
    default: return { kind: "unknown" };
  }
}
function transcripts(value: unknown): InternalRunTranscript[] {
  runEnsure(Array.isArray(value) && value.length <= TRANSCRIPT_MAX_TRANSCRIPTS);
  return value.map(one => {
    runEnsure(isRecord(one) && count(one.candidate_index) && Array.isArray(one.events));
    return { candidate_index: one.candidate_index, events: one.events.slice(0, TRANSCRIPT_MAX_ITEMS).map(transcriptItem), omitted: Math.max(0, one.events.length - TRANSCRIPT_MAX_ITEMS) };
  });
}
export function adaptInternalRun(value: unknown): InternalRunData {
  runEnsure(isRecord(value));
  runEnsure(uuid(value.id));
  runEnsure(purpose(value.purpose));
  runEnsure(RUN_STATUSES.includes(value.status as InternalRunStatus));
  runEnsure(isRecord(value.affected));
  runEnsure(text(value.affected.kind));
  runEnsure(text(value.affected.id));
  runEnsure(nullable(value.affected.project_id, uuid));
  runEnsure(text(value.instructions));
  runEnsure(text(value.input));
  runEnsure(Array.isArray(value.attempts) && value.attempts.length <= 64);
  runEnsure(optionalText(value.reason));
  runEnsure(optionalText(value.detail));
  runEnsure(optionalText(value.provider));
  runEnsure(optionalText(value.model));
  runEnsure(optionalText(value.diagnosis));
  runEnsure(optionalField(value.way, way => WAYS.includes(String(way))));
  runEnsure(optionalCount(value.elapsed_ms));
  runEnsure(optionalCount(value.finished_at_ms));
  runEnsure(count(value.created_at_ms));
  runEnsure(optionalField(value.usage, usage => isRecord(usage) && count(usage.input_tokens) && count(usage.output_tokens)));
  runEnsure(["none", "supervisor", "owner", "resolved"].includes(String(value.escalation)));
  runEnsure(optionalField(value.retry_of, uuid));
  const affected = value.affected as InternalRunData["affected"], known = value as unknown as InternalRunData;
  const optional = Object.fromEntries(OPTIONAL_RUN_FIELDS.filter(key => known[key] !== undefined).map(key => [key, known[key]]));
  return {
    ...optional, id: known.id, purpose: known.purpose, status: known.status, affected: { kind: affected.kind, id: affected.id, project_id: affected.project_id },
    instructions: known.instructions, input: known.input, attempts: value.attempts.map(attempt), created_at_ms: known.created_at_ms, escalation: known.escalation,
    ...(value.transcripts === undefined ? {} : { transcripts: transcripts(value.transcripts) }),
  };
}
function runsUrl(params: InternalRunQuery) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return `/api/internal-work/runs${query.size ? `?${query}` : ""}`;
}
export async function listInternalRuns(params: InternalRunQuery, signal?: AbortSignal): Promise<InternalRunPage> {
  const value = await apiGet<unknown>(runsUrl(params), signal);
  runEnsure(isRecord(value));
  runEnsure(Array.isArray(value.runs) && value.runs.length <= 100);
  runEnsure(value.next_cursor === null || text(value.next_cursor));
  return { runs: value.runs.map(adaptInternalRun), next_cursor: value.next_cursor as string | null };
}
export async function readInternalRun(id: string, signal?: AbortSignal) { return adaptInternalRun(await apiGet<unknown>(`/api/internal-work/runs/${encodeURIComponent(id)}`, signal)); }
export async function retryInternalRun(id: string): Promise<{ id: string }> {
  const value = await apiSend<unknown>("POST", `/api/internal-work/runs/${encodeURIComponent(id)}/retry`, undefined);
  runEnsure(isRecord(value) && uuid(value.id));
  return { id: value.id };
}
