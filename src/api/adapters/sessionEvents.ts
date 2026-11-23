import { validateSessionEventsSchema } from "./sessionEventsSchema";
import { ContractError, isRecord, timestampMs as time } from "./contract";
import { adaptUsageBinding, sameUsageBinding } from "./sessionUsage";
import type { UsageArtifact, UsageBinding } from "../wire/sessionUsage";

export const EVENTS_CAPABILITY = "session.events.read";
export type EventRow = {
  id: string; sequence: number; digest: string; kind: string; label: string; observedAt: number; recordedAt: number;
  source: { id: string; generation: number; kind: string; nativeKey: string; cursor: string; parser: UsageArtifact; fingerprint: string };
  accounting: string; raw: string; references: { label: string; artifact: UsageArtifact }[];
};
export type EventsPage = { binding: UsageBinding; after: number; through: number; next: number | null; checkedAt: number; items: EventRow[] };
export type EventsCursor = { after: number; through?: number };
function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid session source events response"); }
function object(value: unknown): Record<string, unknown> { check(isRecord(value)); return value; }

function cursor(value: unknown): string {
  const v = object(value);
  if (v.kind === "bytes") { check(Number(v.end) > Number(v.start)); return `Bytes ${v.start}–${v.end}`; }
  return `Record ${v.id}`;
}
function artifact(value: unknown): UsageArtifact { return value as UsageArtifact; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function typedBody(value: unknown): Record<string, unknown> {
  const body = object(value), kind = object(body.kind);
  // serde Option fields deserialize an omitted value to None and serialize null.
  if (kind.kind === "gap" && !Object.hasOwn(kind, "affected")) return { ...body, kind: { ...kind, affected: null } };
  if (kind.kind === "usage") {
    const usage = object(kind.usage);
    if (!Object.hasOwn(usage, "correction_of")) return { ...body, kind: { ...kind, usage: { ...usage, correction_of: null } } };
  }
  return body;
}
export async function eventBodyDigest(body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(typedBody(body)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
const words = (value: unknown) => String(value).replaceAll("_", " ");
function sourceRecord(p: Record<string, unknown>, kind: Record<string, unknown>) {
  const c = object(p.cursor), raw = object(p.raw_record); const sourceCursor = cursor(c);
  if (raw.kind === "available") {
    check(Number(raw.byte_length) > 0);
    if (c.kind === "bytes") check(Number(c.end) - Number(c.start) === raw.byte_length);
  } else check(kind.kind === "gap" && kind.reason === raw.reason);
  if (kind.kind === "gap" && kind.affected != null) cursor(kind.affected);
  return { raw, sourceCursor };
}

function checkAccounting(mark: Record<string, unknown>, kind: Record<string, unknown>, record: Record<string, unknown>) {
  check((kind.kind === "usage") !== (mark.kind === "observation_only"));
  if (mark.kind === "contribution_recorded") {
    const event = object(mark.event); check(event.event_id === record.event_id && event.digest === record.body_digest);
    if (mark.supersedes != null) check(object(mark.supersedes).event_id !== record.event_id);
  }
  if (mark.kind === "not_charged" || mark.kind === "unresolved") check(typeof mark.reason === "string" && /^[a-z_]{1,64}$/.test(mark.reason));
}

function checkUsage(kind: Record<string, unknown>, record: Record<string, unknown>) {
  if (kind.kind === "usage") {
    const usage = object(kind.usage), basis = object(usage.basis), cost = object(usage.cost);
    if (basis.kind === "cumulative") check(Number(basis.counter_generation) > 0);
    if (cost.kind !== "unknown") check(typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency));
    if (usage.correction_of != null) check(object(usage.correction_of).event_id !== record.event_id);
  }
}

const EVENT_LABELS = new Map([
  ["usage", "Usage report"], ["tool_result", "Tool result reference"], ["question", "Question reference"],
]);

function eventLabel(kind: Record<string, unknown>) {
  switch (kind.kind) {
    case "turn_boundary": return kind.in_turn ? "Turn started" : "Turn ended";
    case "tool_started": return `Tool started · ${kind.tool_name}`;
    case "provider_error": return `Provider error report · ${kind.code}`;
    case "text_reference": return `Text reference · ${kind.role}`;
    case "gap": return `Source gap · ${words(kind.reason)}`;
    default: return EVENT_LABELS.get(String(kind.kind)) ?? words(kind.kind);
  }
}
async function row(value: unknown, binding: UsageBinding): Promise<EventRow> {
  const v = object(value), record = object(v.record), body = object(record.body), p = object(body.provenance), kind = object(body.kind), mark = object(v.accounting);
  check(sameUsageBinding(adaptUsageBinding(body.binding), binding));
  check(Number(body.sequence) > 0);
  check(time(v.recorded_at_ms));
  check(body.observed_at_ms === 0 || time(body.observed_at_ms));
  check(Number(p.source_generation) > 0);
  const { raw, sourceCursor } = sourceRecord(p, kind);
  checkAccounting(mark, kind, record);
  checkUsage(kind, record);
  check(new TextEncoder().encode(JSON.stringify({ ...record, body: typedBody(body) })).length <= 65536);
  // Rust canonical_bytes: compact UTF-8, recursively sorted ASCII object keys,
  // ordered arrays and exact unsigned integer values (unsafe JS integers refuse).
  check(await eventBodyDigest(body) === record.body_digest);
  const label = eventLabel(kind);
  const references: EventRow["references"] = [];
  if (kind.content != null) references.push({ label: "Content reference · bytes not loaded", artifact: artifact(kind.content) });
  const source = { id: String(p.source_id), generation: Number(p.source_generation), kind: String(p.source_kind), nativeKey: String(p.native_session_key), cursor: sourceCursor, parser: artifact(p.parser), fingerprint: canonical({ kind: p.source_kind, key: p.native_session_key, parser: p.parser }) };
  return { id: String(record.event_id), sequence: Number(body.sequence), digest: String(record.body_digest), kind: String(kind.kind), label,
    observedAt: body.observed_at_ms, recordedAt: Number(v.recorded_at_ms), source, references,
    accounting: mark.kind === "contribution_recorded" ? "Contribution recorded · historical" : mark.kind === "observation_only" ? "Observation only" : `${words(mark.kind)} · ${words(mark.reason)}`,
    raw: raw.kind === "available" ? `Source bytes reported available · ${raw.byte_length} bytes` : `Source bytes unavailable · ${words(raw.reason)}` };
}
export async function adaptSessionEvents(raw: unknown, expected: UsageBinding, request: EventsCursor): Promise<EventsPage> {
  check(new TextEncoder().encode(JSON.stringify(raw)).length <= 262144); validateSessionEventsSchema(raw);
  const v = object(raw), binding = adaptUsageBinding(v.binding);
  check(v.schema_version === 1);
  check(sameUsageBinding(binding, adaptUsageBinding(expected)));
  check(v.after_sequence === request.after);
  check(time(v.checked_at_ms));
  check(Number(v.through_sequence) >= request.after);
  if (request.through !== undefined) check(v.through_sequence === request.through);
  check(Array.isArray(v.events) && v.events.length <= 16);
  const items = await Promise.all(v.events.map(item => row(item, binding)));
  let previous = request.after; const ids = new Set<string>();
  for (const item of items) {
    check(item.sequence > previous);
    check(item.sequence <= Number(v.through_sequence));
    check(!ids.has(item.id));
    previous = item.sequence;
    ids.add(item.id);
  }
  check(v.complete_for_snapshot ? v.next_after === null : items.length > 0 && v.next_after === previous);
  const page = { binding, after: request.after, through: Number(v.through_sequence), next: v.next_after as number | null, checkedAt: Number(v.checked_at_ms), items };
  consistentSources(items); return page;
}
function consistentSources(items: readonly EventRow[]) {
  const sources = new Map<string, string>();
  for (const item of items) { const source = `${item.source.id}:${item.source.generation}`, old = sources.get(source); check(old === undefined || old === item.source.fingerprint); sources.set(source, item.source.fingerprint); }
}
export function mergeEventPages(pages: readonly EventsPage[]): EventRow[] {
  const items: EventRow[] = [], ids = new Set<string>();
  let next = 0;
  check(pages.length <= 4);
  for (const page of pages) {
    check(page.after === next);
    check(page.through === pages[0]!.through);
    check(sameUsageBinding(page.binding, pages[0]!.binding));
    for (const item of page.items) {
      check(!ids.has(item.id)); ids.add(item.id); items.push(item);
    }
    next = page.next ?? -1;
  }
  consistentSources(items); return items;
}
