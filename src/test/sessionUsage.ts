import { USAGE_CATEGORIES, type SessionUsage, type UsageBinding } from "../api/wire/sessionUsage";

export const usageId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const usageBinding = (n = 1): UsageBinding => ({
  project_id: usageId(10), task_id: usageId(20 + n), lineage_id: usageId(30 + n), attempt_id: usageId(40 + n), attempt_generation: 2,
  session: { kind: "remote", node_id: usageId(50), boot_id: usageId(60), attempt_id: usageId(40 + n), assignment_generation: 2, session_id: usageId(70 + n) },
});
export function usageFixture(binding = usageBinding(), empty = false): SessionUsage {
  return {
    schema_version: 1, binding, revision: empty ? 0 : 2, checked_at_ms: 1793511000000, last_recorded_at_ms: empty ? null : 1793510990000,
    usage: {
      ledger_revision: { id: "aq.session-usage", version: empty ? "0" : "2", digest: "a".repeat(64) },
      counters: Object.fromEntries(USAGE_CATEGORIES.map(category => [category, { kind: "unknown", reason: empty ? "not_reported" : "incomplete" }])) as SessionUsage["usage"]["counters"],
      counter_generation: null, costs: [{ kind: "unknown", reason: "not_reported" }],
      completeness: empty ? { kind: "unknown" } : { kind: "incomplete", reason: "native stream coverage and cost policy are not yet verified" },
    },
    known_category_subtotals: empty ? [0, 0, 0, 0, 0] : [120, 30, 0, 0, 4], canonical_calls: empty ? 0 : 2, incomplete_calls: empty ? 0 : 1, unresolved_events: empty ? 0 : 1,
  };
}
