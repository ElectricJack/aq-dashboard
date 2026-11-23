import { canonicalUuid, timestampMs, ContractError, isRecord, nullable, boundedList } from "./contract";
export type ResultMetadata = {
  report_id: string; revision: string; project_id: string; task_id: string; attempt_id: string;
  recorded_at_ms: number; conclusion: string; process_outcome: string;
  current_report_head: boolean; head_report_id: string; supersedes: string | null;
  repository_id: string; source_base: { format: "sha1" | "sha256"; hex: string };
  source_receipt_ids: string[]; pending_effect_ids: string[];
};
export type ResultPage = { schema_version: 1; server_time_ms: number; coverage: "recorded_legacy_native_only"; items: ResultMetadata[]; next_after: string | null };
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid retained result metadata"); }
function digest(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{64}$/.test(v); }
function ids(v: unknown): v is string[] { return boundedList(v, 64, canonicalUuid) && new Set(v).size === v.length; }
type ExactResult = { id: string; revision: string };

function validBase(base: unknown): boolean {
  if (!isRecord(base)) return false;
  const { format, hex } = base;
  if (!["sha1", "sha256"].includes(String(format))) return false;
  const length = format === "sha1" ? 40 : 64;
  return typeof hex === "string" && hex.length === length && /^[0-9a-f]+$/.test(hex);
}

function validateSource(row: Record<string, unknown>) {
  ensure(canonicalUuid(row.repository_id));
  ensure(validBase(row.source_base));
  ensure(ids(row.source_receipt_ids));
  ensure(ids(row.pending_effect_ids));
}

function validateOutcome(row: Record<string, unknown>) {
  ensure(typeof row.conclusion === "string" && row.conclusion.trim().length > 0 && row.conclusion.length <= 512);
  ensure(typeof row.process_outcome === "string" && ["success", "failed", "cancelled", "expired", "unknown"].includes(row.process_outcome));
  ensure(canonicalUuid(row.head_report_id));
  ensure(row.current_report_head === (row.report_id === row.head_report_id));
  ensure(nullable(row.supersedes, id => canonicalUuid(id) && id !== row.report_id));
}

function validateResult(row: unknown, exact?: ExactResult, project?: string): asserts row is ResultMetadata {
  ensure(isRecord(row));
  ensure([row.report_id, row.project_id, row.task_id, row.attempt_id].every(canonicalUuid));
  ensure(digest(row.revision));
  ensure(timestampMs(row.recorded_at_ms));
  ensure(!project || row.project_id === project);
  ensure(!exact || (row.report_id === exact.id && row.revision === exact.revision));
  validateOutcome(row);
  validateSource(row);
}

function validatePageHeader(raw: unknown): asserts raw is Record<string, unknown> & {items: unknown[]} {
  ensure(isRecord(raw));
  ensure(raw.schema_version === 1 && raw.coverage === "recorded_legacy_native_only");
  ensure(timestampMs(raw.server_time_ms));
  ensure(Array.isArray(raw.items) && raw.items.length <= 25);
  ensure(nullable(raw.next_after, canonicalUuid));
}

export function adaptResults(raw: unknown, project?: string, exact?: ExactResult, after?: string): ResultPage {
  validatePageHeader(raw);
  let previous = after;
  for (const row of raw.items) {
    validateResult(row, exact, project);
    ensure(!previous || row.report_id > previous);
    previous = row.report_id;
  }
  ensure(!exact || (raw.items.length === 1 && raw.next_after === null));
  ensure(raw.next_after === null || (raw.items.length > 0 && raw.next_after === previous));
  return raw as ResultPage;
}
