/** Explicit proposed mock fixtures; imported only by the mock harness. */
import { http, HttpResponse } from "msw";
import { decisionFixtures, fixtureReceipt, fixtureSummary, FIXTURE_PRINCIPAL_ID, SERVER_TIME_MS, type FixtureDecision } from "./decisionFixtures";

type Options = {
  /** D04 read behaviour of the scenario: `failed` refuses reads, `empty` lists nothing. */
  reads?: "ok" | "partial" | "empty" | "failed";
  /** `?scenario=decision-conflict`: every answer is refused with 409. */
  conflict?: boolean;
  /** The bootstrap principal; answers are recorded as this owner. */
  principal?: string;
};

const refuse = (status: number, code: string, message: string) =>
  HttpResponse.json({ request_id: "mock", code, message, retryable: status >= 500 }, { status });

type Answer = Record<string, unknown> & { operation_id: string; choice: "approve" | "reject" };
function validAnswer(body: Record<string, unknown> | null, decision: FixtureDecision): body is Answer {
  if (body?.schema_version !== 1 || body.decision_id !== decision.request.decision_id) return false;
  return typeof body.operation_id === "string" && (body.choice === "approve" || body.choice === "reject");
}
function matchingReceipt(d: FixtureDecision, answer: Answer) {
  const receipt = d.receipt;
  if (receipt?.finality.operation_id === answer.operation_id && receipt.finality.choice === answer.choice) return receipt;
  return null;
}
function currentDecision(d: FixtureDecision, expected: unknown) {
  return d.state === "pending" && d.current_report_head && d.decision_revision === expected;
}

/**
 * Review inbox, detail and resolve over the labelled fixtures in decisionFixtures.ts.
 * Answers are kept for the life of the mock session, so a recorded review moves from
 * Open to Resolved and repeating the same operation returns the same receipt.
 */
export function decisionHandlers({ reads = "ok", conflict = false, principal = FIXTURE_PRINCIPAL_ID }: Options = {}) {
  const decisions = new Map(decisionFixtures().map((d) => [d.request.decision_id, d] as const));
  const unavailable = () => refuse(503, "read_model_unavailable", "The review read model is temporarily unavailable.");
  return [
    http.get("/api/reviews/decisions", ({ request }) => {
      if (reads === "failed") return unavailable();
      const query = new URL(request.url).searchParams;
      const open = query.get("state") !== "closed";
      const project = query.get("project_id");
      const items = reads === "empty" ? [] : [...decisions.values()]
        .filter((d) => (d.state === "pending") === open && (!project || d.subject.project_id === project))
        .map((d) => fixtureSummary(d, principal));
      return HttpResponse.json({ api_version: "review-inbox-1", server_time_ms: SERVER_TIME_MS, sampled: true, next_cursor: null, items });
    }),
    http.get("/api/reviews/decisions/:id", ({ params }) => {
      if (reads === "failed") return unavailable();
      const d = decisions.get(String(params.id));
      return d ? HttpResponse.json(d) : refuse(404, "not_found", "This review does not exist or is not available to you.");
    }),
    http.post("/api/reviews/decisions/:id/resolve", async ({ params, request }) => {
      const d = decisions.get(String(params.id));
      if (!d) return refuse(404, "not_found", "This review does not exist or is not available to you.");
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!validAnswer(body, d)) return refuse(400, "invalid_answer", "The answer does not match this review.");
      const choice = body.choice;
      // Repeating the operation that recorded the answer returns its receipt.
      const replay = matchingReceipt(d, body);
      if (replay) return HttpResponse.json(replay);
      if (conflict || !currentDecision(d, body.expected_decision_revision))
        return refuse(409, "decision_conflict", "The review changed before this answer was recorded.");
      if (!d.request.eligible_owners.includes(principal)) return refuse(403, "not_eligible", "You are not an eligible owner of this review.");
      const receipt = fixtureReceipt(d, choice, body.operation_id, principal, SERVER_TIME_MS + 1_000);
      const answered: FixtureDecision = { ...d, decision_revision: 2, state: "answered", receipt };
      decisions.set(d.request.decision_id, answered);
      return HttpResponse.json(receipt);
    }),
  ];
}
