import { freezePlaybookAction, parseInputs, playbookCapability } from "./playbookActions";

const PROJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("cancel freezes a run subject without a version and carries the reason", () => {
  const frozen = freezePlaybookAction("playbook.run.cancel", PROJECT, { type: "playbook_run", id: "run-0000000000000001" }, { run_id: "run-0000000000000001" }, "Stop it");
  const body = JSON.parse(frozen.bytes);
  expect(body).toEqual({ operation_id: frozen.id, kind: "playbook.run.cancel", subject: { type: "playbook_run", id: "run-0000000000000001" }, expected_versions: {}, reason: "Stop it",
    payload: { run_id: "run-0000000000000001", operation_id: frozen.id, project_id: PROJECT } });
  expect(frozen.kind).toBe("playbook.run.cancel"); expect(Object.isFrozen(frozen)).toBe(true);
});
test("activation pins the expected binding revision", () => {
  const frozen = freezePlaybookAction("playbook.activation.activate", PROJECT, { type: "playbook_binding", id: "worker-recovery", revision: "7" }, { binding: "worker-recovery", artifact: `sha256:${"c".repeat(64)}` });
  const body = JSON.parse(frozen.bytes);
  expect(body.expected_versions).toEqual({ playbook_binding: "7" }); expect(body.subject.revision).toBe("7");
  expect(body.payload).toMatchObject({ binding: "worker-recovery", expected_version: "7", project_id: PROJECT }); expect(body.reason).toBeUndefined();
});
test("capabilities follow the proposed names", () => {
  expect(["playbook.run.start", "playbook.run.cancel", "playbook.activation.activate", "playbook.activation.rollback"].map(k => playbookCapability(k as never)))
    .toEqual(["playbooks.runs.start", "playbooks.runs.cancel", "playbooks.activations.activate", "playbooks.activations.rollback"]);
});
test("typed inputs parse without a JSON editor and reject ambiguous rows", () => {
  expect(parseInputs([{ name: "limit", type: "number", value: "3" }, { name: "dry_run", type: "boolean", value: "true" }, { name: "note", type: "text", value: "hi" }]))
    .toEqual({ limit: 3, dry_run: true, note: "hi" });
  expect(parseInputs([])).toEqual({});
  expect(() => parseInputs([{ name: "limit", type: "number", value: "abc" }])).toThrow("Input limit must be a number.");
  expect(() => parseInputs([{ name: " ", type: "text", value: "x" }])).toThrow("Name every input.");
  expect(() => parseInputs([{ name: "a", type: "text", value: "1" }, { name: "a", type: "text", value: "2" }])).toThrow("Input a is listed twice.");
});
