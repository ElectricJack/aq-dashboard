import { sameSession } from "./terminalTail";
import { ContractError, isRecord, nullable, sameFields, timestampMs as timestamp } from "./contract";
import { USAGE_CATEGORIES, type SessionUsage, type UsageBinding, type UsageArtifact } from "../wire/sessionUsage";

function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid session usage response"); }
function shape(value: unknown, fields: string): asserts value is Record<string, unknown> {
  check(isRecord(value));
  const keys = fields.split(" ");
  check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function integer(value: unknown, min = 0): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= min; }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) && value !== "00000000-0000-0000-0000-000000000000"; }
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value) && new TextEncoder().encode(value).length <= 512;
}
function artifact(value: unknown): asserts value is UsageArtifact {
  shape(value, "id version digest");
  check(text(value.id));
  check(text(value.version));
  check(typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest));
}
function unknownReason(value: unknown) { check(typeof value === "string" && ["not_reported", "unsupported", "source_gap", "not_applicable", "incomplete"].includes(value)); }

export function adaptUsageBinding(raw: unknown): UsageBinding {
  shape(raw, "project_id task_id lineage_id attempt_id attempt_generation session");
  check(uuid(raw.project_id));
  check(uuid(raw.task_id));
  check(uuid(raw.lineage_id));
  check(uuid(raw.attempt_id));
  check(integer(raw.attempt_generation, 1));
  check(isRecord(raw.session));
  const session = raw.session;
  if (session.kind === "remote") {
    shape(session, "kind node_id boot_id attempt_id assignment_generation session_id");
    check(uuid(session.node_id));
    check(uuid(session.boot_id));
    check(uuid(session.attempt_id));
    check(uuid(session.session_id));
    check(integer(session.assignment_generation, 1));
    check(session.attempt_id === raw.attempt_id && session.assignment_generation === raw.attempt_generation);
  } else {
    shape(session, "kind authority_id session_id generation");
    check(session.kind === "central");
    check(uuid(session.authority_id));
    check(uuid(session.session_id));
    check(integer(session.generation, 1));
  }
  return raw as unknown as UsageBinding;
}

export function sameUsageBinding(a: UsageBinding, b: UsageBinding): boolean {
  return sameFields(a, b, ["project_id", "task_id", "lineage_id", "attempt_id", "attempt_generation"])
    && sameSession(a.session, b.session);
}

/** Anchor supplied by the independently authorized session-detail read. */
export function adaptSessionUsageAnchor(detail: { id: string; project: { id: string }; task: { id: string } | null; attempt_id: string | null; session_identity?: unknown; observation_binding?: unknown }): UsageBinding | null {
  if (detail.observation_binding == null) return null;
  const binding = adaptUsageBinding(detail.observation_binding);
  check(binding.project_id === detail.project.id);
  check(binding.task_id === detail.task?.id);
  check(binding.attempt_id === detail.attempt_id);
  check(binding.session.session_id === detail.id);
  // The summary's full session identity is a second independent pin, not just its display ID.
  check(isRecord(detail.session_identity));
  const session = { ...detail.session_identity };
  const generation = session.kind === "remote" ? "assignment_generation" : "generation";
  const value = session[generation];
  // dashboard-read-1 serializes revisions as strings; raw observation bindings use u64.
  check(typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value));
  session[generation] = Number(value);
  check(sameUsageBinding(binding, adaptUsageBinding({ ...binding, session })));
  return binding;
}

function validateCounters(counters: unknown, subtotals: unknown[], counts: { canonical_calls: number; incomplete_calls: number; unresolved_events: number }) {
  shape(counters, USAGE_CATEGORIES.join(" "));
  for (const [index, category] of USAGE_CATEGORIES.entries()) {
    const counter = counters[category];
    check(isRecord(counter));
    if (counter.kind === "known") {
      shape(counter, "kind value");
      check(integer(counter.value) && counter.value === subtotals[index]);
      check(counts.canonical_calls > 0);
      check(counts.incomplete_calls === 0);
      check(counts.unresolved_events === 0);
    } else { shape(counter, "kind reason"); check(counter.kind === "unknown"); unknownReason(counter.reason); }
  }
}

function validateCosts(costs: unknown) {
  check(Array.isArray(costs) && costs.length <= 8);
  for (const cost of costs) {
    check(isRecord(cost));
    if (cost.kind === "unknown") { shape(cost, "kind reason"); unknownReason(cost.reason); continue; }
    check(integer(cost.amount_microunits));
    check(typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency));
    if (cost.kind === "provider_reported") { shape(cost, "kind amount_microunits currency receipt"); artifact(cost.receipt); }
    else {
      shape(cost, "kind amount_microunits currency rate_card basis allocation_policy");
      check(cost.kind === "non_invoice_estimate");
      check(typeof cost.basis === "string" && ["token_rates", "subscription_allocation", "local_model_allocation"].includes(cost.basis));
      artifact(cost.rate_card); artifact(cost.allocation_policy);
    }
  }
}

function validateCompleteness(completeness: unknown) {
  check(isRecord(completeness));
  if (completeness.kind === "unknown") shape(completeness, "kind");
  else if (completeness.kind === "incomplete") { shape(completeness, "kind reason"); check(text(completeness.reason)); }
  else { shape(completeness, "kind policy"); check(completeness.kind === "complete_for_policy"); artifact(completeness.policy); }
  return completeness;
}

/** The independently inspected session binding is mandatory; usage cannot anchor itself. */
export function adaptSessionUsage(raw: unknown, expected: UsageBinding): SessionUsage {
  shape(raw, "schema_version binding revision checked_at_ms last_recorded_at_ms usage known_category_subtotals canonical_calls incomplete_calls unresolved_events");
  check(raw.schema_version === 1);
  check(sameUsageBinding(adaptUsageBinding(raw.binding), adaptUsageBinding(expected)));
  check(integer(raw.revision));
  check(timestamp(raw.checked_at_ms));
  if (raw.last_recorded_at_ms !== null) {
    check(timestamp(raw.last_recorded_at_ms));
    check(raw.last_recorded_at_ms <= raw.checked_at_ms);
  }
  check(integer(raw.canonical_calls));
  check(integer(raw.incomplete_calls) && raw.incomplete_calls <= raw.canonical_calls);
  check(integer(raw.unresolved_events));
  check(Array.isArray(raw.known_category_subtotals));
  check(raw.known_category_subtotals.length === 5);
  check(raw.known_category_subtotals.every(value => integer(value)));
  check(raw.canonical_calls > 0 || raw.known_category_subtotals.every(value => value === 0));
  shape(raw.usage, "ledger_revision counters counter_generation costs completeness");
  const usage = raw.usage;
  artifact(usage.ledger_revision);
  check(usage.ledger_revision.id === "aq.session-usage");
  check(usage.ledger_revision.version === String(raw.revision));
  check(nullable(usage.counter_generation, value => integer(value, 1)));
  validateCounters(usage.counters, raw.known_category_subtotals, {
    canonical_calls: raw.canonical_calls, incomplete_calls: raw.incomplete_calls, unresolved_events: raw.unresolved_events,
  });
  validateCosts(usage.costs);
  const completeness = validateCompleteness(usage.completeness);
  if (raw.revision === 0) {
    check(raw.last_recorded_at_ms === null);
    check(raw.canonical_calls === 0);
    check(raw.incomplete_calls === 0);
    check(raw.unresolved_events === 0);
    check(completeness.kind === "unknown");
  } else check(raw.last_recorded_at_ms !== null);
  return raw as unknown as SessionUsage;
}
