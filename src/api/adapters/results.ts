import { ContractError, isRecord } from "./contract";
export type ResultMetadata = {
  report_id: string; revision: string; project_id: string; task_id: string; attempt_id: string;
  recorded_at_ms: number; conclusion: string; process_outcome: string;
  current_report_head: boolean; head_report_id: string; supersedes: string | null;
  repository_id: string; source_base: { format: "sha1" | "sha256"; hex: string };
  source_receipt_ids: string[]; pending_effect_ids: string[];
};
export type ResultPage = { schema_version: 1; server_time_ms: number; coverage: "recorded_legacy_native_only"; items: ResultMetadata[]; next_after: string | null };
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid retained result metadata"); }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000"; }
function digest(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{64}$/.test(v); }
function stamp(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000; }
function ids(v: unknown): v is string[] { return Array.isArray(v) && v.length <= 64 && v.every(uuid) && new Set(v).size === v.length; }
export function adaptResults(raw: unknown, project?: string, exact?: { id: string; revision: string }, after?: string): ResultPage {
  ensure(isRecord(raw) && raw.schema_version === 1 && stamp(raw.server_time_ms) && raw.coverage === "recorded_legacy_native_only" && Array.isArray(raw.items) && raw.items.length <= 25 && (raw.next_after === null || uuid(raw.next_after)));
  const seen = new Set<string>();
  let previous = after;
  for (const row of raw.items) {
    ensure(isRecord(row) && uuid(row.report_id) && digest(row.revision) && uuid(row.project_id) && uuid(row.task_id) && uuid(row.attempt_id) && stamp(row.recorded_at_ms));
    ensure(!seen.has(row.report_id) && (!previous || row.report_id > previous)); seen.add(row.report_id); previous = row.report_id;
    ensure(!project || row.project_id === project);
    ensure(!exact || (row.report_id === exact.id && row.revision === exact.revision));
    ensure(typeof row.conclusion === "string" && row.conclusion.trim().length > 0 && row.conclusion.length <= 512);
    ensure(typeof row.process_outcome === "string" && ["success", "failed", "cancelled", "expired", "unknown"].includes(row.process_outcome));
    ensure(typeof row.current_report_head === "boolean" && uuid(row.head_report_id) && row.current_report_head === (row.report_id === row.head_report_id));
    ensure(row.supersedes === null || (uuid(row.supersedes) && row.supersedes !== row.report_id));
    ensure(uuid(row.repository_id) && isRecord(row.source_base));
    ensure(["sha1", "sha256"].includes(String(row.source_base.format)) && typeof row.source_base.hex === "string" && /^[0-9a-f]+$/.test(row.source_base.hex) && row.source_base.hex.length === (row.source_base.format === "sha1" ? 40 : 64));
    ensure(ids(row.source_receipt_ids) && ids(row.pending_effect_ids));
  }
  ensure(!exact || (raw.items.length === 1 && raw.next_after === null));
  ensure(raw.next_after === null || (raw.items.length > 0 && raw.next_after === raw.items[raw.items.length - 1].report_id));
  return raw as ResultPage;
}
