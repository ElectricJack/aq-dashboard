import { useQuery } from "@tanstack/react-query";
import { useSession } from "../app/session";
import { ContractError, isRecord } from "./adapters/contract";
import { ApiError, apiGet, apiSend } from "./client";
import { queryKey } from "./queryKeys";

/**
 * Roles, intelligence profiles and execution profiles as Settings documents (aq-server spec 0014, crate `aq-role-settings`).
 * Each is one Markdown document; the server answers with the text and the fields it parsed from it.
 */
export const DOCUMENT_PATHS = { role: "roles", intelligence: "intelligence-profiles", execution: "execution-profiles" } as const;
export type DocumentKind = keyof typeof DOCUMENT_PATHS;
export const DOCUMENT_KINDS = Object.keys(DOCUMENT_PATHS) as DocumentKind[];

export type RoleFields = { id: string; name: string; description: string; execution: string; operations: string[]; enabled: boolean; role_md: string; rules_md: string };
export type Candidate = { provider: string; model: string; reasoning: string; harnesses: string[] };
/** The keys a level states under `## Selection`; a cost key stated as `none` arrives as null. */
export type SelectionOverrides = Record<string, string | number | boolean | string[] | null>;
export type IntelligenceFields = { id: string; name: string; description: string; candidates: Candidate[]; selection: SelectionOverrides };
export const EXECUTION_LIMIT_KEYS = ["wall_time_ms", "memory_bytes", "cpu_millis", "process_limit", "startup_context_bytes", "max_output_tokens"] as const;
export type ExecutionLimits = Record<typeof EXECUTION_LIMIT_KEYS[number], number>;
export type ExecutionFields = { id: string; name: string; description: string; harnesses: string[]; environment: string; confinement: string; credentials: Record<string, string>; limits: ExecutionLimits };
export type DocumentFields = { role: RoleFields; intelligence: IntelligenceFields; execution: ExecutionFields };
/** `fields` is what the server parsed from `markdown`; when it does not parse, `fields` is null and `problem` says why. */
export type SettingsDocument<K extends DocumentKind = DocumentKind> = { kind: K; id: string; revision: string; updated_at_ms: number; markdown: string; fields: DocumentFields[K] | null; problem: string | null };
export type DocumentList<K extends DocumentKind = DocumentKind> = { revision: string; active_digest: string | null; documents: SettingsDocument<K>[] };
/** One thing wrong with the set of documents, in the server's words. `field` is empty when it is the whole document. */
export type Problem = { document: string; field: string; message: string };
export type SaveReceipt = { revision: string; digest: string };
export type ProfileSnapshot = { revision: string; active_digest: string | null };

export const FALLBACK_REASONS = ["missing_credentials", "unavailable", "unsupported", "stale_unknown", "policy_denied"] as const;
export type FallbackReason = typeof FALLBACK_REASONS[number];
export type UnknownCost = "allow_bounded" | "deny";
/** The selection policy every level starts from; a level overrides single keys in its own document. */
export type SelectionDefaults = {
  max_attempts: number; fallback_on: FallbackReason[]; max_lineage_elapsed_ms: number; observation_max_age_ms: number;
  allow_unknown_availability: boolean; unknown_cost: UnknownCost; require_complete_accounting: boolean; require_hard_cost_enforcement: boolean;
  max_cost_microunits: number | null; currency: string | null;
};
export const DOCUMENT_LIMIT_KEYS = ["max_document_bytes", "max_set_bytes", "max_documents_per_kind", "max_name_bytes", "max_description_bytes"] as const;
export type ProfileLimits = { documents: Record<typeof DOCUMENT_LIMIT_KEYS[number], number>; snapshots_kept: number; operations_kept: number };

const MAX_DOCUMENTS = 4096, MAX_MARKDOWN_CHARS = 8 * 1024 * 1024;
const text = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length <= max;
const revision = (v: unknown): v is string => typeof v === "string" && v.length <= 32 && /^(0|[1-9]\d*)$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v);
const texts = (v: unknown, max = 256): v is string[] => Array.isArray(v) && v.length <= max && v.every(item => text(item));
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid role settings response"); }

function identity(v: unknown): asserts v is Record<string, unknown> & { id: string; name: string; description: string } {
  ensure(isRecord(v) && text(v.id, 128) && text(v.name) && text(v.description, 65_536));
}
function roleFields(v: unknown): RoleFields {
  identity(v);
  ensure(text(v.execution, 128) && texts(v.operations) && typeof v.enabled === "boolean" && text(v.role_md, MAX_MARKDOWN_CHARS) && text(v.rules_md, MAX_MARKDOWN_CHARS));
  return { id: v.id, name: v.name, description: v.description, execution: v.execution, operations: v.operations, enabled: v.enabled, role_md: v.role_md, rules_md: v.rules_md };
}
function intelligenceFields(v: unknown): IntelligenceFields {
  identity(v);
  ensure(Array.isArray(v.candidates) && v.candidates.length <= 1024 && (v.selection === undefined || isRecord(v.selection)));
  const candidates = v.candidates.map((c: unknown): Candidate => {
    ensure(isRecord(c) && text(c.provider) && text(c.model) && text(c.reasoning) && texts(c.harnesses, 16));
    return { provider: c.provider, model: c.model, reasoning: c.reasoning, harnesses: c.harnesses };
  });
  const selection: SelectionOverrides = {};
  for (const [key, value] of Object.entries(v.selection ?? {})) {
    ensure(value === null || text(value) || typeof value === "boolean" || count(value) || texts(value, 16));
    selection[key] = value;
  }
  return { id: v.id, name: v.name, description: v.description, candidates, selection };
}
function executionFields(v: unknown): ExecutionFields {
  identity(v);
  ensure(texts(v.harnesses, 16) && text(v.environment) && text(v.confinement, 64) && isRecord(v.credentials) && isRecord(v.limits));
  const credentials: Record<string, string> = {};
  for (const [harness, credential] of Object.entries(v.credentials)) { ensure(text(credential)); credentials[harness] = credential; }
  const limits = {} as ExecutionLimits;
  for (const key of EXECUTION_LIMIT_KEYS) { const value = v.limits[key]; ensure(count(value)); limits[key] = value; }
  return { id: v.id, name: v.name, description: v.description, harnesses: v.harnesses, environment: v.environment, confinement: v.confinement, credentials, limits };
}
const FIELDS: { [K in DocumentKind]: (v: unknown) => DocumentFields[K] } = { role: roleFields, intelligence: intelligenceFields, execution: executionFields };

export function adaptDocument<K extends DocumentKind>(kind: K, v: unknown): SettingsDocument<K> {
  ensure(isRecord(v) && v.kind === kind && text(v.id, 128) && v.id.length > 0 && revision(v.revision) && count(v.updated_at_ms) && text(v.markdown, MAX_MARKDOWN_CHARS));
  ensure(v.problem === null || text(v.problem, 65_536));
  // A stored document that no longer parses has no fields; the text and the reason are still shown.
  ensure(v.fields === null ? v.problem !== null : v.problem === null);
  return { kind, id: v.id, revision: v.revision, updated_at_ms: v.updated_at_ms, markdown: v.markdown, fields: v.fields === null ? null : FIELDS[kind](v.fields), problem: v.problem };
}
export function adaptDocumentList<K extends DocumentKind>(kind: K, v: unknown): DocumentList<K> {
  ensure(isRecord(v) && revision(v.revision) && (v.active_digest === null || digest(v.active_digest)) && Array.isArray(v.documents) && v.documents.length <= MAX_DOCUMENTS);
  const documents = v.documents.map((document: unknown) => adaptDocument(kind, document));
  ensure(new Set(documents.map(document => document.id)).size === documents.length);
  return { revision: v.revision, active_digest: v.active_digest, documents };
}
export function adaptReceipt(v: unknown): SaveReceipt {
  ensure(isRecord(v) && revision(v.revision) && digest(v.digest));
  return { revision: v.revision, digest: v.digest };
}
export function adaptSnapshot(v: unknown): ProfileSnapshot {
  ensure(isRecord(v) && revision(v.revision) && (v.active_digest === null || digest(v.active_digest)));
  return { revision: v.revision, active_digest: v.active_digest };
}
export function adaptSelectionDefaults(v: unknown): { revision: string; selection_defaults: SelectionDefaults } {
  ensure(isRecord(v) && revision(v.revision) && isRecord(v.selection_defaults));
  const d = v.selection_defaults;
  ensure(count(d.max_attempts) && Array.isArray(d.fallback_on) && d.fallback_on.every(reason => FALLBACK_REASONS.includes(reason as FallbackReason)) && count(d.max_lineage_elapsed_ms) && count(d.observation_max_age_ms));
  ensure(typeof d.allow_unknown_availability === "boolean" && (d.unknown_cost === "allow_bounded" || d.unknown_cost === "deny") && typeof d.require_complete_accounting === "boolean" && typeof d.require_hard_cost_enforcement === "boolean");
  ensure((d.max_cost_microunits === null || count(d.max_cost_microunits)) && (d.currency === null || text(d.currency, 16)));
  return { revision: v.revision, selection_defaults: {
    max_attempts: d.max_attempts, fallback_on: d.fallback_on as FallbackReason[], max_lineage_elapsed_ms: d.max_lineage_elapsed_ms, observation_max_age_ms: d.observation_max_age_ms,
    allow_unknown_availability: d.allow_unknown_availability, unknown_cost: d.unknown_cost, require_complete_accounting: d.require_complete_accounting,
    require_hard_cost_enforcement: d.require_hard_cost_enforcement, max_cost_microunits: d.max_cost_microunits, currency: d.currency,
  } };
}
export function adaptProfileLimits(v: unknown): { revision: string; limits: ProfileLimits } {
  ensure(isRecord(v) && revision(v.revision) && isRecord(v.limits) && isRecord(v.limits.documents) && count(v.limits.snapshots_kept) && count(v.limits.operations_kept));
  const documents = {} as ProfileLimits["documents"];
  for (const key of DOCUMENT_LIMIT_KEYS) { const value = v.limits.documents[key]; ensure(count(value)); documents[key] = value; }
  return { revision: v.revision, limits: { documents, snapshots_kept: v.limits.snapshots_kept, operations_kept: v.limits.operations_kept } };
}

/** The problems of a refused save or delete (400), each naming its document and field; empty for any other failure. */
export function problemsOf(error: unknown): Problem[] {
  const body = error instanceof ApiError ? error.body : undefined;
  if (!isRecord(body) || !Array.isArray(body.problems)) return [];
  return body.problems.slice(0, 256).flatMap((p: unknown) => isRecord(p) && text(p.document) && text(p.field) && text(p.message, 65_536) ? [{ document: p.document, field: p.field, message: p.message }] : []);
}
/** A problem as the server itself writes it. */
export const problemText = (problem: Problem) => problem.field ? `${problem.document}: ${problem.field}: ${problem.message}` : `${problem.document}: ${problem.message}`;

const base = "/api/settings";
const documentPath = (kind: DocumentKind, id: string) => `${base}/${DOCUMENT_PATHS[kind]}/${encodeURIComponent(id)}`;
/** Every change names the revision it was read at (`"0"` for a document that does not exist yet) and an operation id; repeating the same change with the same id is answered with the first receipt. */
export type Fence = { expected_revision: string; operation_id: string };

export async function readDocuments<K extends DocumentKind>(kind: K, signal?: AbortSignal) { return adaptDocumentList(kind, await apiGet<unknown>(`${base}/${DOCUMENT_PATHS[kind]}`, signal)); }
export async function readDocument<K extends DocumentKind>(kind: K, id: string, signal?: AbortSignal) { return adaptDocument(kind, await apiGet<unknown>(documentPath(kind, id), signal)); }
export async function saveDocument(kind: DocumentKind, id: string, request: Fence & { markdown: string }) { return adaptReceipt(await apiSend<unknown>("PUT", documentPath(kind, id), request)); }
export async function deleteDocument(kind: DocumentKind, id: string, fence: Fence) {
  return adaptReceipt(await apiSend<unknown>("DELETE", `${documentPath(kind, id)}?${new URLSearchParams(fence)}`, undefined));
}
export async function readSelectionDefaults(signal?: AbortSignal) { return adaptSelectionDefaults(await apiGet<unknown>(`${base}/selection-defaults`, signal)); }
export async function saveSelectionDefaults(request: Fence & { selection_defaults: SelectionDefaults }) { return adaptReceipt(await apiSend<unknown>("PUT", `${base}/selection-defaults`, request)); }
export async function readProfileLimits(signal?: AbortSignal) { return adaptProfileLimits(await apiGet<unknown>(`${base}/profiles/limits`, signal)); }
export async function saveProfileLimits(request: Fence & { limits: ProfileLimits }) { return adaptReceipt(await apiSend<unknown>("PUT", `${base}/profiles/limits`, request)); }
export async function readProfileSnapshot(signal?: AbortSignal) { return adaptSnapshot(await apiGet<unknown>(`${base}/profiles/snapshot`, signal)); }

/** Every read of these routes shares this resource name, so one invalidation refreshes them all after a save. */
export const ROLE_SETTINGS = "role-settings";
export function useDocuments<K extends DocumentKind>(kind: K) {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, ROLE_SETTINGS, { documents: kind }), queryFn: ({ signal }) => readDocuments(kind, signal), retry: false });
}
export function useSelectionDefaults() {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, ROLE_SETTINGS, { value: "selection-defaults" }), queryFn: ({ signal }) => readSelectionDefaults(signal), retry: false });
}
export function useProfileLimits() {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, ROLE_SETTINGS, { value: "limits" }), queryFn: ({ signal }) => readProfileLimits(signal), retry: false });
}
export function useProfileSnapshot() {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, ROLE_SETTINGS, { value: "snapshot" }), queryFn: ({ signal }) => readProfileSnapshot(signal), retry: false });
}
