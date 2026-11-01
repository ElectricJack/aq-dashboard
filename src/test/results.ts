import type { ResultMetadata, ResultPage } from "../api/adapters/results";
export const resultId = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
export function resultRecord(n = 1): ResultMetadata { return {
  report_id: resultId(n), revision: "a".repeat(64), project_id: resultId(100), task_id: resultId(101), attempt_id: resultId(102),
  recorded_at_ms: 1793518233880, conclusion: `Retained worker claim ${n}`, process_outcome: "success", current_report_head: true,
  head_report_id: resultId(n), supersedes: null, repository_id: resultId(103), source_base: { format: "sha1", hex: "b".repeat(40) }, source_receipt_ids: [resultId(104)], pending_effect_ids: []
}; }
export function resultPage(items = [resultRecord()], next_after: string | null = null): ResultPage { return { schema_version: 1, server_time_ms: 1793518234000, coverage: "recorded_legacy_native_only", items, next_after }; }
