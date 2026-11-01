import { adaptSessionUsage, adaptSessionUsageAnchor, adaptUsageBinding } from "./sessionUsage";
import { usageBinding, usageFixture, usageId } from "../../test/sessionUsage";
import type { UsageBinding } from "../wire/sessionUsage";

test("retains partial subtotals without turning unknown counters or unreported cost into zero", () => {
  const raw = usageFixture();
  const view = adaptSessionUsage(raw, usageBinding());
  expect(view.usage.counters.input).toEqual({ kind: "unknown", reason: "incomplete" });
  expect(view.known_category_subtotals).toEqual([120, 30, 0, 0, 4]);
  expect(view.usage.costs).toEqual([{ kind: "unknown", reason: "not_reported" }]);
  expect(adaptSessionUsage(usageFixture(usageBinding(), true), usageBinding()).revision).toBe(0);
});
test.each(["project_id", "task_id", "lineage_id", "attempt_id", "attempt_generation"] as const)("rejects cross-session or stale %s", key => {
  const raw = usageFixture();
  raw.binding[key] = (key === "attempt_generation" ? 3 : usageId(999)) as never;
  expect(() => adaptSessionUsage(raw, usageBinding())).toThrow();
});
test.each(["node_id", "boot_id", "attempt_id", "assignment_generation", "session_id"] as const)("rejects a different remote session %s even when outer IDs match", key => {
  const raw = usageFixture();
  if (raw.binding.session.kind !== "remote") throw new Error("fixture");
  raw.binding.session[key] = (key === "assignment_generation" ? 3 : usageId(999)) as never;
  expect(() => adaptSessionUsage(raw, usageBinding())).toThrow();
});
test("compares central authority and generation too", () => {
  const binding: UsageBinding = { ...usageBinding(), session: { kind: "central", authority_id: usageId(80), session_id: usageId(71), generation: 2 } };
  expect(adaptSessionUsage(usageFixture(binding), binding).binding).toEqual(binding);
  for (const session of [{ ...binding.session, authority_id: usageId(81) }, { ...binding.session, generation: 3 }]) {
    expect(() => adaptSessionUsage(usageFixture({ ...binding, session }), binding)).toThrow();
  }
});
test("rejects unsafe integers, malformed variants, projection contradictions and unnegotiated fields", () => {
  const bad = [
    { ...usageFixture(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...usageFixture(), incomplete_calls: 3 },
    { ...usageFixture(), known_category_subtotals: [1, 2] },
    { ...usageFixture(), schema_version: 2 },
    { ...usageFixture(), quota_remaining: 50 },
    { ...usageFixture(usageBinding(), true), canonical_calls: 1 },
    { ...usageFixture(), last_recorded_at_ms: 1793511000001 },
  ];
  for (const raw of bad) expect(() => adaptSessionUsage(raw, usageBinding())).toThrow();
  const raw = usageFixture();
  raw.usage.counters.input = { kind: "known", value: 120 };
  expect(() => adaptSessionUsage(raw, usageBinding())).toThrow();
  raw.incomplete_calls = 0; raw.unresolved_events = 0;
  expect(adaptSessionUsage(raw, usageBinding()).usage.counters.input).toEqual({ kind: "known", value: 120 });
  expect(() => adaptUsageBinding({ ...usageBinding(), session: { kind: "future" } })).toThrow();
});
test("anchors the numeric binding to independent dashboard IDs and decimal-string full session identity", () => {
  const binding = usageBinding();
  const detail = { id: binding.session.session_id, project: { id: binding.project_id }, task: { id: binding.task_id }, attempt_id: binding.attempt_id,
    observation_binding: binding, session_identity: { ...binding.session, assignment_generation: "2" } };
  expect(adaptSessionUsageAnchor(detail)).toEqual(binding);
  expect(adaptSessionUsageAnchor({ ...detail, observation_binding: null })).toBeNull();
  expect(adaptSessionUsageAnchor({ ...detail, observation_binding: undefined })).toBeNull();
  for (const patch of [{ id: usageId(999) }, { attempt_id: usageId(999) }, { task: { id: usageId(999) } }, { project: { id: usageId(999) } },
    { session_identity: { ...detail.session_identity, boot_id: usageId(999) } }, { session_identity: { ...detail.session_identity, assignment_generation: "9007199254740993" } },
    { session_identity: undefined }]) expect(() => adaptSessionUsageAnchor({ ...detail, ...patch })).toThrow();
});
