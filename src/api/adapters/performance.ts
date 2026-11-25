import { boundedList, ContractError, isRecord, timestampMs } from "./contract";

export const PERFORMANCE = "performance.metrics.v1";
export const PERFORMANCE_PATH = "/api/v1/performance";

export type Unavailable = { state: "unavailable"; reason: string };
type Section<T> = T | Unavailable;
type Observation = { state: "complete" | "partial"; reason: string | null; observed_at_ms: number | null };
type Timing = { median_ms: number | null; p90_ms: number | null; covered: number; total: number };
export type OutcomeTask = {
  task_id: string;
  project_id: string;
  completion_at_ms: number | null;
  merge_at_ms: number | null;
  first_ready_at_ms: number | null;
  delivery_at_ms: number | null;
  first_pass: string | null;
  disposition: string;
  delivery_evidence?: string | null;
};
export type Outcomes = Section<{
  confirmed_completions: number;
  verified_merges: number;
  completions_with_unknown_date: number;
  first_pass_acceptance: { numerator: number; denominator: number; value: number | null; unknown: number };
  delivery: { state: "available" | "not_tracked" | "partial"; delivered_tasks: number | null; definitions: string[]; timing: Timing; unknown_definitions: number; unknown_required_pr_sets?: number };
  completion_timing: Timing;
  merge_timing: Timing;
  tasks: OutcomeTask[];
}>;
export type Hold = {
  task_id: string;
  project_id: string;
  reason: string;
  since_ms: number;
  age_ms: number;
  responsible_party: string | null;
  next_check_at_ms: number | null;
};
export type Holds = Section<Observation & {
  count: number;
  oldest_age_ms: number | null;
  missed_checks: number;
  rows: Hold[];
  next_cursor: string | null;
}>;
export type MachineSample = {
  minute_ms: number;
  state: "online" | "partial" | "stale" | "offline" | "paused";
  enabled_slots: number | null;
  occupied_slots: number | null;
  free_slots: number | null;
};
export type Machine = {
  id: string;
  label: string;
  samples: MachineSample[];
  detail_complete: boolean;
  idle_with_queue: { start_ms: number; end_ms: number }[];
  utilization: { occupied_slot_minutes: number; enabled_slot_minutes: number; value: number | null };
};
export type Ready = { minute_ms: number; count: number | null; accuracy: "exact" | "lower_bound" | "unknown" };
export type Machines = Section<Observation & {
  coverage: { observed_minutes: number; expected_minutes: number };
  machines: Machine[];
  ready: Ready[];
}>;
export type Scheduling = Section<{
  reason_counts: { reason: string; count: number }[];
  examples: { task_id: string; reason: string; observed_at_ms: number }[];
  claims: number;
  covered_claims: number;
  p50_eligible_to_claim_ms: number | null;
  p95_eligible_to_claim_ms: number | null;
  dropped_observations: number;
}>;
type Tokens = Record<"input" | "output" | "cache_read" | "cache_write" | "reasoning", number | null>;
export type Cost = { currency: string; basis: string; microunits: number };
export type Model = { model: string | null; harness: string | null; calls: number; missing_prices: number; incomplete_calls: number; tokens: Tokens; costs: Cost[] };
type UsageCoverage = { expected_attempts: number; complete_attempts: number; canonical_calls: number; priced_calls: number; unresolved_events: number };
export type UsageData = {
  status: "observed" | "partial" | "no_events";
  models: Model[];
  coverage: UsageCoverage;
  costs: Cost[];
  truncated: boolean;
  window_basis: string;
  unassigned?: { canonical_calls: number; priced_calls: number; costs: Cost[] };
  shared_overhead?: { scope: string; finished_runs: number; reported_runs: number; input_tokens: number | null; output_tokens: number | null };
};
export type Usage = Section<UsageData>;
export type TaskUsage = Section<UsageData & {
  first_route: { attempt_id: string; candidate: string | null; policy_revision: number | null; registry_revision: number | null; recorded_at_ms: number; intended_model: string | null } | null;
  attempts: { attempt_id: string; status: string; attempt_status: string | null; intended_model: string | null; models: Model[]; costs: Cost[]; unresolved_events: number }[];
}>;
type Snapshot = { cutoff_ms: number; definition_version: 1 };
export type SummaryData = Snapshot & { outcomes: Outcomes; usage: Usage };
export type MachineData = Snapshot & { machines: Machines; scheduling: Scheduling };
export type HoldData = Snapshot & { holds: Holds };
export type TaskData = Snapshot & { usage: TaskUsage | null; first_pass?: OutcomeTask | Unavailable | null };

export function unavailable(section: object): section is Unavailable {
  return "state" in section && section.state === "unavailable";
}

export function adaptPerformance<T extends Snapshot>(sections: Record<string, readonly string[]>, expectedCutoff?: number, nullableSection?: string) {
  return (data: unknown): T => {
    if (!isRecord(data) || data.definition_version !== 1 || !timestampMs(data.cutoff_ms) ||
        (expectedCutoff !== undefined && data.cutoff_ms !== expectedCutoff)) {
      throw new ContractError("Invalid performance snapshot");
    }
    for (const [name, arrays] of Object.entries(sections)) {
      const section = data[name];
      if (name === nullableSection && section === null) continue;
      if (!isRecord(section) || (section.state === "unavailable"
        ? typeof section.reason !== "string"
        : !validSection(section, arrays))) {
        throw new ContractError(`Invalid performance section: ${name}`);
      }
    }
    return data as T;
  };
}

export const summarySections = { outcomes: ["tasks"], usage: ["models", "costs"] };
export const machineSections = { machines: ["machines", "ready"], scheduling: ["reason_counts", "examples"] };
export const holdSections = { holds: ["rows"] };
export const taskSections = { usage: ["models", "costs", "attempts"] };

function objectFields(value: Record<string, unknown>, names: string[]) {
  return names.every(name => isRecord(value[name]));
}

function validSection(section: Record<string, unknown>, arrays: readonly string[]) {
  if (!arrays.every(field => boundedList(section[field], 4_000, isRecord))) return false;
  if (arrays.includes("tasks")) {
    return objectFields(section, ["first_pass_acceptance", "completion_timing", "merge_timing"]) &&
      isRecord(section.delivery) && objectFields(section.delivery, ["timing"]) &&
      boundedList(section.delivery.definitions, 3, item => typeof item === "string") &&
      boundedList(section.tasks, 50, item => isRecord(item) && typeof item.disposition === "string");
  }
  if (arrays.includes("machines")) {
    return objectFields(section, ["coverage"]) && boundedList(section.machines, 256, item =>
      isRecord(item) && objectFields(item, ["utilization"]) &&
      boundedList(item.samples, 1_440, sample => isRecord(sample) && typeof sample.state === "string") &&
      boundedList(item.idle_with_queue, 144, isRecord));
  }
  if (arrays.includes("models")) {
    return objectFields(section, ["coverage"]) && validModels(section.models) &&
      (!arrays.includes("attempts") || boundedList(section.attempts, 64, attempt =>
        isRecord(attempt) && typeof attempt.status === "string" && validModels(attempt.models) && Array.isArray(attempt.costs)));
  }
  return true;
}

function validModels(models: unknown) {
  return boundedList(models, 64, model => isRecord(model) && isRecord(model.tokens) && Array.isArray(model.costs));
}
