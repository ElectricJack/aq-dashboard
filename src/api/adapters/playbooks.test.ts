import { adaptAdmissions, adaptRunDetail, adaptRuns, mergeRunPages, statusLabel } from "./playbooks";
import { PLAYBOOK_NAMESPACE, playbookPage, runDetail, runRecord } from "../../test/playbooks";
test("safe run and timeline adapters keep exact revision/sequence strings", () => {
  const p = adaptRuns(playbookPage([runRecord()]), PLAYBOOK_NAMESPACE.project_id);
  expect(p.revision).toBe("9007199254740993");
  const d = adaptRunDetail(runDetail(), PLAYBOOK_NAMESPACE.project_id, p.items[0]!.id);
  expect(d.receipts.items[1]!.sequence).toBe("9007199254740993");
  expect(d.run.pendingKind).toBe("effect"); expect(d.run.dependencies.checks).toMatch(/^sha256:/);
});
test("rejects foreign project, wrong version and mismatched run identity", () => {
  expect(() => adaptRuns(playbookPage([]), "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toThrow();
  expect(() => adaptRuns({ ...playbookPage([]), api_version: "other" }, null)).toThrow();
  expect(() => adaptRunDetail(runDetail(), null, "different-run")).toThrow();
  const d = runDetail(); d.effects.namespace = { ...PLAYBOOK_NAMESPACE, generation: "2" };
  expect(() => adaptRunDetail(d, null, d.run.id)).toThrow();
});
test("rejects oversized pages, duplicate/backward keys and cursors that skip rows", () => {
  expect(() => adaptRuns(playbookPage(Array.from({ length: 26 }, () => runRecord())), null)).toThrow();
  expect(() => adaptRuns(playbookPage([runRecord(), runRecord()]), null)).toThrow();
  expect(() => adaptRuns(playbookPage([runRecord()], "run-skipped"), null)).toThrow();
  const p = adaptRuns(playbookPage([runRecord()]), null); expect(() => mergeRunPages([p, p])).toThrow();
});
test("rejects duplicate or backward receipt sequences without Number coercion", () => {
  const d = runDetail(); d.receipts.items[1]!.sequence = d.receipts.items[0]!.sequence;
  expect(() => adaptRunDetail(d, null, d.run.id)).toThrow();
  expect(() => adaptRunDetail(runDetail(), null, d.run.id, "9007199254740993")).toThrow();
});
test("admission pending remains distinct from confirmed engine run and unknown status is explicit", () => {
  const p = adaptAdmissions({ ...playbookPage([{ request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "pending", created_at_ms: 1, run_id: null, activation_revision: null, catalog_revision: null }]), revision: null }, null);
  expect(p.items[0]!.runId).toBeNull();expect(p.revision).toBeNull();expect(statusLabel("future_state")).toBe("Unsupported state");
});
