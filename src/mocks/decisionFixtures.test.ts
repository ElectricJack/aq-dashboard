import { adaptBootstrap } from "../api/adapters/bootstrap";
import { adaptDecision, adaptDecisions, validateAnswerReceipt } from "../api/adapters/decisions";
import { DECISION_FIXTURE_IDS, decisionFixtures, fixtureSummary, FIXTURE_PRINCIPAL_ID, withDecisionFixtures } from "./decisionFixtures";
import { scenario } from "./scenarios";

test("every decision fixture satisfies the review adapters and is labelled", () => {
  const all = decisionFixtures();
  for (const d of all) {
    const view = adaptDecision(d, d.request.decision_id, FIXTURE_PRINCIPAL_ID);
    expect(view.eligible).toBe(true);
    expect(view.criteria.every((c) => c.startsWith("Fixture"))).toBe(true);
    expect(view.conclusion).toMatch(/^Fixture · /);
    if (d.receipt) expect(() => validateAnswerReceipt(d.receipt, view, d.receipt!.finality.operation_id, d.receipt!.finality.choice, FIXTURE_PRINCIPAL_ID)).not.toThrow();
  }
  const page = adaptDecisions({ api_version: "review-inbox-1", server_time_ms: 1, sampled: true, next_cursor: null, items: all.map((d) => fixtureSummary(d, FIXTURE_PRINCIPAL_ID)) });
  const byId = new Map(page.items.map((i) => [i.decisionId, i]));
  expect(byId.get(DECISION_FIXTURE_IDS.current)).toMatchObject({ state: "pending", current: true });
  expect(byId.get(DECISION_FIXTURE_IDS.superseded)).toMatchObject({ state: "pending", current: false });
  expect(byId.get(DECISION_FIXTURE_IDS.otherProject)?.projectId).not.toBe(byId.get(DECISION_FIXTURE_IDS.current)?.projectId);
  expect([byId.get(DECISION_FIXTURE_IDS.approved)?.state, byId.get(DECISION_FIXTURE_IDS.rejected)?.state]).toEqual(["answered", "answered"]);
});

test("mock bootstrap names an eligible UUID principal and offers decisions.resolve", () => {
  const b = adaptBootstrap(withDecisionFixtures(scenario("default").bootstrap));
  expect(b.principal.id).toBe(FIXTURE_PRINCIPAL_ID);
  expect(b.capability("decisions.resolve").enabled).toBe(true);
  expect(adaptBootstrap(withDecisionFixtures(scenario("actions-unavailable").bootstrap)).capability("decisions.resolve").enabled).toBe(false);
});
