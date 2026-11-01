export type UsageSessionIdentity =
  | { kind: "remote"; node_id: string; boot_id: string; attempt_id: string; assignment_generation: number; session_id: string }
  | { kind: "central"; authority_id: string; session_id: string; generation: number };
export type UsageBinding = { project_id: string; task_id: string; lineage_id: string; attempt_id: string; attempt_generation: number; session: UsageSessionIdentity };
export type UnknownUsageReason = "not_reported" | "unsupported" | "source_gap" | "not_applicable" | "incomplete";
export type UsageCounter = { kind: "known"; value: number } | { kind: "unknown"; reason: UnknownUsageReason };
export type UsageArtifact = { id: string; version: string; digest: string };
export type UsageCost =
  | { kind: "unknown"; reason: UnknownUsageReason }
  | { kind: "provider_reported"; amount_microunits: number; currency: string; receipt: UsageArtifact }
  | { kind: "non_invoice_estimate"; amount_microunits: number; currency: string; rate_card: UsageArtifact; basis: "token_rates" | "subscription_allocation" | "local_model_allocation"; allocation_policy: UsageArtifact };
export const USAGE_CATEGORIES = ["input", "output", "cache_read", "cache_write", "reasoning"] as const;
export type SessionUsage = {
  schema_version: 1; binding: UsageBinding; revision: number; checked_at_ms: number; last_recorded_at_ms: number | null;
  usage: { ledger_revision: UsageArtifact; counters: Record<typeof USAGE_CATEGORIES[number], UsageCounter>; counter_generation: number | null; costs: UsageCost[];
    completeness: { kind: "unknown" } | { kind: "incomplete"; reason: string } | { kind: "complete_for_policy"; policy: UsageArtifact } };
  known_category_subtotals: [number, number, number, number, number]; canonical_calls: number; incomplete_calls: number; unresolved_events: number;
};
