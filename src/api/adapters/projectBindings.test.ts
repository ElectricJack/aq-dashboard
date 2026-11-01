import { adaptProjectBindings, mergeProjectPages, validationLabel } from "./projectBindings";
import { projectRecord } from "../../test/projectBindings";
test("projects are explicit configuration and recorded checks, including unknown future check statuses", () => {
  const row = projectRecord(); row.validation.graph = "future_state";
  const p = adaptProjectBindings({ items: [row], next_cursor: null }, null).items[0]!;
  expect(p.name).toBe("Project 1"); expect(p.revision).toBe(2); expect(p.validation.recordedAt).toBe("1970-01-01T00:00:10.000Z");
  expect(validationLabel(p.validation.graph)).toBe("Unknown"); expect(p).not.toHaveProperty("ready");
});
test("refuses unsafe counters, foreign check identity, duplicate/unsorted rows and unbounded pages/profiles", () => {
  const bad = projectRecord(); bad.validation.repository_id = projectRecord(2).binding.project_id;
  const badRevision = { ...projectRecord(), revision: Number.MAX_SAFE_INTEGER + 1 };
  const badProfiles = projectRecord(); badProfiles.binding.allowed_agent_profiles = Array.from({ length: 33 }, (_, i) => `profile${i}@1`);
  for (const items of [[bad], [badRevision], [badProfiles], [projectRecord(), projectRecord()], Array.from({ length: 26 }, (_, i) => projectRecord(i + 1))]) expect(() => adaptProjectBindings({ items, next_cursor: null }, null)).toThrow();
});
test("validates cursor advancement and exact last-row binding", () => {
  const items = Array.from({ length: 25 }, (_, i) => projectRecord(i + 1));
  expect(adaptProjectBindings({ items, next_cursor: items[24]!.binding.project_id }, null).next).toBe(items[24]!.binding.project_id);
  expect(() => adaptProjectBindings({ items, next_cursor: items[0]!.binding.project_id }, null)).toThrow();
  expect(() => adaptProjectBindings({ items: [projectRecord()], next_cursor: null }, projectRecord().binding.project_id)).toThrow();
});

test("refuses duplicate/backward cross-page identities after concurrent list changes", () => {
  const p = adaptProjectBindings({ items: [projectRecord()], next_cursor: null }, null);
  expect(() => mergeProjectPages([p, p])).toThrow();
});

test("empty explicit node list remains group-only admission, never unrestricted", () => {
  const record = projectRecord();
  const p = adaptProjectBindings({ items: [record], next_cursor: null }, null).items[0]!;
  expect(p.nodeIds).toEqual([]); expect(p.workerGroups).toEqual(["engineering"]);
  record.binding.allowed_worker_groups = [];
  expect(() => adaptProjectBindings({ items: [record], next_cursor: null }, null)).toThrow();
});
