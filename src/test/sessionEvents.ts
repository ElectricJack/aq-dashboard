import examples from "../../contracts/live/session-events/examples.json";
import { eventBodyDigest } from "../api/adapters/sessionEvents";
import type { UsageBinding } from "../api/wire/sessionUsage";
import { usageBinding, usageId } from "./sessionUsage";

/** Explicit synthetic source reports; copied public Rust golden is tested separately. */
export async function sourceEvent(sequence = 1, binding = usageBinding(), kind: Record<string, unknown> = { kind: "tool_started", call_id: "fixture-call", tool_name: "fixture-tool" }) {
  const original = examples.events.events[0]!;
  const provenance = structuredClone(original.record.body.provenance);
  if (kind.kind === "gap") provenance.raw_record = { kind: "unavailable", reason: String(kind.reason) } as unknown as typeof provenance.raw_record;
  const body = { binding, provenance, sequence, observed_at_ms: 1793510990000, kind };
  return { record: { event_id: usageId(1000 + sequence), body, body_digest: await eventBodyDigest(body) }, recorded_at_ms: 1793510990100,
    accounting: kind.kind === "usage" ? structuredClone(original.accounting) : { kind: "observation_only" } };
}
export async function eventsFixture(options: { binding?: UsageBinding; sequence?: number; after?: number; through?: number; more?: boolean; gap?: boolean; empty?: boolean } = {}) {
  const binding = options.binding ?? usageBinding(), sequence = options.sequence ?? 1;
  const item = await sourceEvent(sequence, binding, options.gap ? { kind: "gap", reason: "truncated", affected: null } : undefined);
  return { schema_version: 1, binding, after_sequence: options.after ?? 0, through_sequence: options.through ?? sequence,
    events: options.empty ? [] : [item], next_after: options.more ? sequence : null, complete_for_snapshot: !options.more, checked_at_ms: 1793511000000 };
}
