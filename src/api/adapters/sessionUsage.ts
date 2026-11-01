import { ContractError, isRecord } from "./contract";
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
function timestamp(value: unknown): value is number { return integer(value, 1) && value <= 8640000000000000; }
function artifact(value: unknown): asserts value is UsageArtifact {
  shape(value, "id version digest");
  check(text(value.id) && text(value.version) && typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest));
}
function unknownReason(value: unknown) { check(typeof value === "string" && ["not_reported", "unsupported", "source_gap", "not_applicable", "incomplete"].includes(value)); }

export function adaptUsageBinding(raw: unknown): UsageBinding {
  shape(raw, "project_id task_id lineage_id attempt_id attempt_generation session");
  check(uuid(raw.project_id) && uuid(raw.task_id) && uuid(raw.lineage_id) && uuid(raw.attempt_id) && integer(raw.attempt_generation, 1));
  check(isRecord(raw.session));
  const session = raw.session;
  if (session.kind === "remote") {
    shape(session, "kind node_id boot_id attempt_id assignment_generation session_id");
    check(uuid(session.node_id) && uuid(session.boot_id) && uuid(session.attempt_id) && uuid(session.session_id) && integer(session.assignment_generation, 1));
    check(session.attempt_id === raw.attempt_id && session.assignment_generation === raw.attempt_generation);
  } else {
    shape(session, "kind authority_id session_id generation");
    check(session.kind === "central" && uuid(session.authority_id) && uuid(session.session_id) && integer(session.generation, 1));
  }
  return raw as unknown as UsageBinding;
}

export function sameUsageBinding(a: UsageBinding, b: UsageBinding): boolean {
  const x = a.session, y = b.session;
  return a.project_id === b.project_id && a.task_id === b.task_id && a.lineage_id === b.lineage_id && a.attempt_id === b.attempt_id && a.attempt_generation === b.attempt_generation &&
    x.kind === y.kind && x.session_id === y.session_id && (x.kind === "remote" && y.kind === "remote"
      ? x.node_id === y.node_id && x.boot_id === y.boot_id && x.attempt_id === y.attempt_id && x.assignment_generation === y.assignment_generation
      : x.kind === "central" && y.kind === "central" && x.authority_id === y.authority_id && x.generation === y.generation);
}

/** Anchor supplied by the independently authorized session-detail read. */
export function adaptSessionUsageAnchor(detail: { id: string; project: { id: string }; task: { id: string } | null; attempt_id: string | null; session_identity?: unknown; observation_binding?: unknown }): UsageBinding | null {
  if (detail.observation_binding == null) return null;
  const binding = adaptUsageBinding(detail.observation_binding);
  check(binding.project_id === detail.project.id && binding.task_id === detail.task?.id && binding.attempt_id === detail.attempt_id && binding.session.session_id === detail.id);
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

/** The independently inspected session binding is mandatory; usage cannot anchor itself. */
export function adaptSessionUsage(raw: unknown, expected: UsageBinding): SessionUsage {
  shape(raw, "schema_version binding revision checked_at_ms last_recorded_at_ms usage known_category_subtotals canonical_calls incomplete_calls unresolved_events");
  check(raw.schema_version === 1 && sameUsageBinding(adaptUsageBinding(raw.binding), adaptUsageBinding(expected)));
  check(integer(raw.revision) && timestamp(raw.checked_at_ms) && (raw.last_recorded_at_ms === null || (timestamp(raw.last_recorded_at_ms) && raw.last_recorded_at_ms <= raw.checked_at_ms)));
  check(integer(raw.canonical_calls) && integer(raw.incomplete_calls) && raw.incomplete_calls <= raw.canonical_calls && integer(raw.unresolved_events));
  check(Array.isArray(raw.known_category_subtotals) && raw.known_category_subtotals.length === 5 && raw.known_category_subtotals.every(value => integer(value)));
  check(raw.canonical_calls > 0 || raw.known_category_subtotals.every(value => value === 0));
  shape(raw.usage, "ledger_revision counters counter_generation costs completeness");
  const usage = raw.usage;
  artifact(usage.ledger_revision);
  check(usage.ledger_revision.id === "aq.session-usage" && usage.ledger_revision.version === String(raw.revision));
  check(usage.counter_generation === null || integer(usage.counter_generation, 1));
  shape(usage.counters, USAGE_CATEGORIES.join(" "));
  for (const [index, category] of USAGE_CATEGORIES.entries()) {
    const counter = usage.counters[category];
    check(isRecord(counter));
    if (counter.kind === "known") {
      shape(counter, "kind value");
      check(integer(counter.value) && counter.value === raw.known_category_subtotals[index] && raw.canonical_calls > 0 && raw.incomplete_calls === 0 && raw.unresolved_events === 0);
    } else { shape(counter, "kind reason"); check(counter.kind === "unknown"); unknownReason(counter.reason); }
  }
  check(Array.isArray(usage.costs) && usage.costs.length <= 8);
  for (const cost of usage.costs) {
    check(isRecord(cost));
    if (cost.kind === "unknown") { shape(cost, "kind reason"); unknownReason(cost.reason); continue; }
    check(integer(cost.amount_microunits) && typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency));
    if (cost.kind === "provider_reported") { shape(cost, "kind amount_microunits currency receipt"); artifact(cost.receipt); }
    else {
      shape(cost, "kind amount_microunits currency rate_card basis allocation_policy");
      check(cost.kind === "non_invoice_estimate" && typeof cost.basis === "string" && ["token_rates", "subscription_allocation", "local_model_allocation"].includes(cost.basis));
      artifact(cost.rate_card); artifact(cost.allocation_policy);
    }
  }
  check(isRecord(usage.completeness));
  const completeness = usage.completeness;
  if (completeness.kind === "unknown") shape(completeness, "kind");
  else if (completeness.kind === "incomplete") { shape(completeness, "kind reason"); check(text(completeness.reason)); }
  else { shape(completeness, "kind policy"); check(completeness.kind === "complete_for_policy"); artifact(completeness.policy); }
  if (raw.revision === 0) {
    check(raw.last_recorded_at_ms === null && raw.canonical_calls === 0 && raw.incomplete_calls === 0 && raw.unresolved_events === 0 && completeness.kind === "unknown");
  } else check(raw.last_recorded_at_ms !== null);
  return raw as unknown as SessionUsage;
}
