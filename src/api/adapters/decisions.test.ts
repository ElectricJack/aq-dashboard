import { adaptDecision, adaptDecisions } from "./decisions";
import { decisionDetail, decisionId, decisionPage } from "../../test/decisions";
test("binds exact detail identity and shows retained evidence without invented impact", () => {
  const d = adaptDecision(decisionDetail(), decisionId(1), decisionId(9));
  expect(d.eligible).toBe(true); expect(d.taskVersion).toBe(3); expect(d.evidence).toHaveLength(5);
  expect(() => adaptDecision(decisionDetail(), decisionId(7), decisionId(9))).toThrow();
});
test("rejects duplicate summaries, unknown states and oversized cursors", () => {
  const p = decisionPage(); expect(adaptDecisions(p).items).toHaveLength(1);
  expect(() => adaptDecisions(p, decisionId(8))).toThrow();
  expect(() => adaptDecisions({ ...p, items: [p.items[0], p.items[0]] })).toThrow();
  expect(() => adaptDecisions({ ...p, items: [{ ...p.items[0], state: "invented" }] })).toThrow();
  expect(() => adaptDecisions({ ...p, next_cursor: "a".repeat(4097) })).toThrow();
});
test("rejects unsafe evidence and malformed source object identities", () => {
  const d = decisionDetail(); d.subject.source.base.hex = "not-a-source";
  expect(() => adaptDecision(d, decisionId(1), decisionId(9))).toThrow();
  const other = decisionDetail(); other.subject.criteria = ["unsafe\u0000text"];
  expect(() => adaptDecision(other, decisionId(1), decisionId(9))).toThrow();
});
test("actual retained criterion text and reported conclusion remain pinned", () => {
  const d = decisionDetail();
  const richer = { ...d, acceptance_criteria: d.subject.criteria.map(id => ({ id, text: `Exact retained text: ${id}` })), recorded_result: { report_id: decisionId(5), conclusion: "Tests completed", process_outcome: "success", recorded_at_ms: 9000 } };
  const view = adaptDecision(richer, decisionId(1), decisionId(9));
  expect(view.criteria[0]).toContain("Exact retained text"); expect(view.conclusion).toBe("Tests completed");
  expect(() => adaptDecision({ ...richer, acceptance_criteria: [{ id: "unrelated", text: "Wrong criterion" }] }, decisionId(1), decisionId(9))).toThrow();
});
