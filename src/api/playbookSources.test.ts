import { adaptSourceList, adaptSourceView, PLAYBOOK_DISPLAY_LIMITS } from "./playbookSources";

const kase = { name: "bug-fix-failed-once", situation: "a bug fix that failed once", result: "class: complex\neffort: high", passed: true };
const active = { artifact: "sha256:" + "a".repeat(64), since_ms: 2, comparison: { change: "behaviour" }, cases: [kase] };
const latest = { run: "r1", status: "saved", question: null, unable: null, refusal: null, internal_task_id: "00000000-0000-4000-8000-000000000001", created_at_ms: 1, finished_at_ms: 2 };
const view = { id: "routing", kind: "builtin", binding: "aq.routing", active, latest };

test("adapts the source view the server returns", () => {
  expect(adaptSourceView(view)).toEqual({ id: "routing", kind: "builtin", binding: "aq.routing",
    active: { artifact: active.artifact, since_ms: 2, comparison: { change: "behaviour" }, cases: [kase] },
    latest: { run: "r1", status: "saved", question: null, unable: [], refusal: null, internal_task_id: latest.internal_task_id, created_at_ms: 1, finished_at_ms: 2 } });
  expect(adaptSourceView({ ...view, active: null, latest: null })).toMatchObject({ active: null, latest: null });
  expect(adaptSourceList({ items: [view, view] })).toHaveLength(2);
});

test("a question carries its sentences in document order with their lines", () => {
  const question = { question: "Which wins?", sentences: [{ line: 3, text: "First." }, { line: 9, text: "Second." }] };
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "question", question } }).latest?.question).toEqual(question);
});

test("what could not be carried out may be one sentence or a list", () => {
  const one = { sentence: "Art goes to the plotter.", reason: "There is no plotter.", line: 12 };
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "unable", unable: one } }).latest?.unable).toEqual([one]);
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "unable", unable: [one, { sentence: "S", reason: "R" }] } }).latest?.unable).toEqual([one, { sentence: "S", reason: "R", line: null }]);
});

test("a run state the dashboard does not know is kept as unknown, and no previous playbook means no comparison", () => {
  expect(adaptSourceView({ ...view, latest: { ...latest, status: "paused" } }).latest?.status).toBe("unknown");
  expect(adaptSourceView({ ...view, active: { ...active, comparison: null } }).active?.comparison).toBeNull();
  const { comparison: _omitted, ...bare } = active;
  expect(adaptSourceView({ ...view, active: bare }).active?.comparison).toBeNull();
});

test("refuses a response outside the contract", () => {
  expect(() => adaptSourceView({ ...view, id: 3 })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, comparison: { change: "rewritten" } } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, active: { ...active, cases: [{ ...kase, passed: "yes" }] } })).toThrow("Contract violation");
  expect(() => adaptSourceView({ ...view, latest: { ...latest, question: { question: "Q", sentences: [{ line: "3", text: "x" }] } } })).toThrow("Contract violation");
  expect(() => adaptSourceList({ items: "none" })).toThrow("Contract violation");
});

test("a very large report is shortened, never refused", () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ ...kase, name: `c${i}`, situation: "s".repeat(300_000) }));
  const adapted = adaptSourceView({ ...view, active: { ...active, cases: many }, latest: { ...latest, status: "refused", refusal: "r".repeat(300_000) } });
  expect(adapted.active?.cases).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.items);
  expect(adapted.active?.cases[0]?.situation).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.textChars);
  expect(adapted.latest?.refusal).toHaveLength(PLAYBOOK_DISPLAY_LIMITS.reasonChars);
});
