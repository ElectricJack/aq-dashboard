import examples from "../../../contracts/live/session-events/examples.json";
import { adaptSessionEvents, eventBodyDigest, mergeEventPages } from "./sessionEvents";
import { adaptUsageBinding } from "./sessionUsage";
import { eventsFixture } from "../../test/sessionEvents";
import { usageBinding, usageId } from "../../test/sessionUsage";
import { ContractError } from "./contract";

test("the unchanged Rust golden validates exact canonical digest and historical accounting", async () => {
  const raw = structuredClone(examples.events), binding = adaptUsageBinding(raw.binding);
  const page = await adaptSessionEvents(raw, binding, { after: 0 });
  expect(page.items[0]!.label).toBe("Usage report");
  expect(page.items[0]!.accounting).toContain("unresolved");
  expect(await eventBodyDigest(raw.events[0]!.record.body)).toBe(raw.events[0]!.record.body_digest);
  const reversed = Object.fromEntries(Object.entries(raw.events[0]!.record.body).reverse());
  expect(await eventBodyDigest(reversed)).toBe(raw.events[0]!.record.body_digest);
});
test("snapshot pages retain exact cursor and source pins, with explicit gap reports", async () => {
  const one = await adaptSessionEvents(await eventsFixture({ through: 9, more: true }), usageBinding(), { after: 0 });
  const two = await adaptSessionEvents(await eventsFixture({ sequence: 9, after: 1, through: 9, gap: true }), usageBinding(), { after: 1, through: 9 });
  expect(mergeEventPages([one, two]).map(row => row.label)).toEqual(["Tool started · fixture-tool", "Source gap · truncated"]);
  expect(two.items[0]!.raw).toBe("Source bytes unavailable · truncated");
});
test("typed canonical Option fields normalize omission to Rust null, not incidental JSON bytes", async () => {
  const raw = await eventsFixture({ gap: true }), body = raw.events[0]!.record.body;
  const expected = raw.events[0]!.record.body_digest;
  delete body.kind.affected;
  expect(await eventBodyDigest(body)).toBe(expected);
  await expect(adaptSessionEvents(raw, usageBinding(), { after: 0 })).resolves.toMatchObject({ items: [{ digest: expected }] });
});
test.each([
  ["foreign attempt", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.binding.attempt_id = usageId(999); }],
  ["closed extra field", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { Object.assign(raw, { unexpected: true }); }],
  ["changed body with original digest", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.record.body.kind.tool_name = "changed"; }],
  ["unsafe sequence", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.record.body.sequence = Number.MAX_SAFE_INTEGER + 1; }],
  ["false terminal snapshot", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.next_after = 1; }],
  ["incomplete empty page", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events = []; raw.complete_for_snapshot = false; raw.next_after = 1; }],
  ["wrong accounting class", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.accounting = { kind: "unresolved", reason: "missing_baseline" } as typeof raw.events[0]["accounting"]; }],
  ["raw span mismatch", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.record.body.provenance.raw_record.byte_length++; }],
  ["source generation zero", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.record.body.provenance.source_generation = 0; }],
  ["unsupported kind", (raw: Awaited<ReturnType<typeof eventsFixture>>) => { raw.events[0]!.record.body.kind.kind = "invented"; }],
])("refuses %s before rendering", async (_label, mutate) => {
  const raw = await eventsFixture(); mutate(raw);
  await expect(adaptSessionEvents(raw, usageBinding(), { after: 0 })).rejects.toThrow(ContractError);
});
test("a fully valid foreign-session page cannot supply its own independent anchor", async () => {
  await expect(adaptSessionEvents(await eventsFixture({ binding: usageBinding(2) }), usageBinding(), { after: 0 })).rejects.toThrow(ContractError);
});
test("foreign snapshot and source substitution fail independently of valid body digests", async () => {
  const one = await adaptSessionEvents(await eventsFixture({ through: 2, more: true }), usageBinding(), { after: 0 });
  const raw = await eventsFixture({ sequence: 2, after: 1, through: 2 });
  await expect(adaptSessionEvents(raw, usageBinding(), { after: 1, through: 3 })).rejects.toThrow();
  raw.events[0]!.record.body.provenance.native_session_key = "substituted";
  raw.events[0]!.record.body_digest = await eventBodyDigest(raw.events[0]!.record.body);
  const two = await adaptSessionEvents(raw, usageBinding(), { after: 1, through: 2 });
  expect(() => mergeEventPages([one, two])).toThrow();
});
test("fifth page and duplicate records never silently extend the loaded snapshot", async () => {
  const page = await adaptSessionEvents(await eventsFixture(), usageBinding(), { after: 0 });
  expect(() => mergeEventPages([page, page])).toThrow();
  expect(() => mergeEventPages([page, page, page, page, page])).toThrow();
});
