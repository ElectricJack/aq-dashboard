import schema from "../../../contracts/live/session-events/events.schema.json";
import { ContractError, isRecord } from "./contract";
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
const definitions = schema.$defs as Record<string, unknown>;
function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid session source events response"); }
function time(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8640000000000000; }
function object(value: unknown): Record<string, unknown> { check(isRecord(value)); return value; }

/** Local interpreter for this pinned closed schema only, not a shared schema engine. */
function validate(rule: unknown, value: unknown, depth = 0): void {
  check(depth < 32); const r = object(rule);
  if (typeof r.$ref === "string") { check(r.$ref.startsWith("#/$defs/")); validate(definitions[r.$ref.slice(8)], value, depth + 1); return; }
  const matches = (candidate: unknown) => { try { validate(candidate, value, depth + 1); return true; } catch { return false; } };
  if (Array.isArray(r.oneOf)) check(r.oneOf.filter(matches).length === 1);
  if (Array.isArray(r.anyOf)) check(r.anyOf.some(matches));
  if (Object.hasOwn(r, "const")) check(value === r.const);
  if (Array.isArray(r.enum)) check(r.enum.includes(value));
  if (r.type === "object") {
    const v = object(value), properties = object(r.properties);
    if (Array.isArray(r.required)) check(r.required.every(key => typeof key === "string" && Object.hasOwn(v, key)));
    check(r.additionalProperties === false && Object.keys(v).every(key => Object.hasOwn(properties, key)));
    for (const [key, item] of Object.entries(v)) validate(properties[key], item, depth + 1);
  } else if (r.type === "array") {
    check(Array.isArray(value));
    if (typeof r.maxItems === "number") check(value.length <= r.maxItems);
    for (const item of value) validate(r.items, item, depth + 1);
  } else if (r.type === "integer") {
    check(typeof value === "number" && Number.isSafeInteger(value));
    if (typeof r.minimum === "number") check(value >= r.minimum);
    if (typeof r.maximum === "number") check(value <= r.maximum);
  } else if (r.type === "string") {
    check(typeof value === "string" && !/\p{Cs}/u.test(value));
    if (typeof r.minLength === "number") check(value.length >= r.minLength);
    if (typeof r.maxLength === "number") check(value.length <= r.maxLength);
    if (typeof r.pattern === "string") check(new RegExp(r.pattern).test(value));
    if (r.format === "uuid") check(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) && value !== "00000000-0000-0000-0000-000000000000");
    if (rule === definitions.Text) check(!/\p{Cc}/u.test(value) && new TextEncoder().encode(value).length <= 512);
  } else if (r.type === "boolean") check(typeof value === "boolean");
  else if (r.type === "null") check(value === null);
}
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
async function row(value: unknown, binding: UsageBinding): Promise<EventRow> {
  const v = object(value), record = object(v.record), body = object(record.body), p = object(body.provenance), kind = object(body.kind), mark = object(v.accounting);
  check(sameUsageBinding(adaptUsageBinding(body.binding), binding) && Number(body.sequence) > 0 && time(v.recorded_at_ms));
  check(typeof body.observed_at_ms === "number" && Number.isSafeInteger(body.observed_at_ms) && body.observed_at_ms >= 0 && body.observed_at_ms <= 8640000000000000);
  check(Number(p.source_generation) > 0);
  const c = object(p.cursor), raw = object(p.raw_record); const sourceCursor = cursor(c);
  if (raw.kind === "available") {
    check(Number(raw.byte_length) > 0);
    if (c.kind === "bytes") check(Number(c.end) - Number(c.start) === raw.byte_length);
  } else check(kind.kind === "gap" && kind.reason === raw.reason);
  if (kind.kind === "gap" && kind.affected != null) cursor(kind.affected);
  check((kind.kind === "usage") !== (mark.kind === "observation_only"));
  if (mark.kind === "contribution_recorded") {
    const event = object(mark.event); check(event.event_id === record.event_id && event.digest === record.body_digest);
    if (mark.supersedes != null) check(object(mark.supersedes).event_id !== record.event_id);
  }
  if (mark.kind === "not_charged" || mark.kind === "unresolved") check(typeof mark.reason === "string" && /^[a-z_]{1,64}$/.test(mark.reason));
  if (kind.kind === "usage") {
    const usage = object(kind.usage), basis = object(usage.basis), cost = object(usage.cost);
    if (basis.kind === "cumulative") check(Number(basis.counter_generation) > 0);
    if (cost.kind !== "unknown") check(typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency));
    if (usage.correction_of != null) check(object(usage.correction_of).event_id !== record.event_id);
  }
  check(new TextEncoder().encode(JSON.stringify({ ...record, body: typedBody(body) })).length <= 65536);
  // Rust canonical_bytes: compact UTF-8, recursively sorted ASCII object keys,
  // ordered arrays and exact unsigned integer values (unsafe JS integers refuse).
  check(await eventBodyDigest(body) === record.body_digest);
  let label = words(kind.kind);
  const references: EventRow["references"] = [];
  if (kind.kind === "turn_boundary") label = kind.in_turn ? "Turn started" : "Turn ended";
  else if (kind.kind === "tool_started") label = `Tool started · ${kind.tool_name}`;
  else if (kind.kind === "provider_error") label = `Provider error report · ${kind.code}`;
  else if (kind.kind === "text_reference") label = `Text reference · ${kind.role}`;
  else if (kind.kind === "gap") label = `Source gap · ${words(kind.reason)}`;
  else if (kind.kind === "usage") label = "Usage report";
  else if (kind.kind === "tool_result") label = "Tool result reference";
  else if (kind.kind === "question") label = "Question reference";
  if (kind.content != null) references.push({ label: "Content reference · bytes not loaded", artifact: artifact(kind.content) });
  const source = { id: String(p.source_id), generation: Number(p.source_generation), kind: String(p.source_kind), nativeKey: String(p.native_session_key), cursor: sourceCursor, parser: artifact(p.parser), fingerprint: canonical({ kind: p.source_kind, key: p.native_session_key, parser: p.parser }) };
  return { id: String(record.event_id), sequence: Number(body.sequence), digest: String(record.body_digest), kind: String(kind.kind), label,
    observedAt: body.observed_at_ms, recordedAt: Number(v.recorded_at_ms), source, references,
    accounting: mark.kind === "contribution_recorded" ? "Contribution recorded · historical" : mark.kind === "observation_only" ? "Observation only" : `${words(mark.kind)} · ${words(mark.reason)}`,
    raw: raw.kind === "available" ? `Source bytes reported available · ${raw.byte_length} bytes` : `Source bytes unavailable · ${words(raw.reason)}` };
}
export async function adaptSessionEvents(raw: unknown, expected: UsageBinding, request: EventsCursor): Promise<EventsPage> {
  check(new TextEncoder().encode(JSON.stringify(raw)).length <= 262144); validate(schema, raw);
  const v = object(raw), binding = adaptUsageBinding(v.binding);
  check(v.schema_version === 1 && sameUsageBinding(binding, adaptUsageBinding(expected)) && v.after_sequence === request.after && time(v.checked_at_ms));
  check(Number(v.through_sequence) >= request.after && (request.through === undefined || v.through_sequence === request.through));
  check(Array.isArray(v.events) && v.events.length <= 16);
  const items = await Promise.all(v.events.map(item => row(item, binding)));
  let previous = request.after; const ids = new Set<string>();
  for (const item of items) { check(item.sequence > previous && item.sequence <= Number(v.through_sequence) && !ids.has(item.id)); previous = item.sequence; ids.add(item.id); }
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
    check(page.after === next && page.through === pages[0]!.through && sameUsageBinding(page.binding, pages[0]!.binding));
    for (const item of page.items) {
      check(!ids.has(item.id)); ids.add(item.id); items.push(item);
    }
    next = page.next ?? -1;
  }
  consistentSources(items); return items;
}
