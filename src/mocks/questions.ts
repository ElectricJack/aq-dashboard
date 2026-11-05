/**
 * Mock-only F5 agent question fixtures (`?scenario=questions`). Every question says
 * "Fixture"; nothing here claims to be a real agent. Shapes follow the live question-inbox-1 read in
 * contracts/live/dashboard-read-g2/schema.json and the live `question.answer` action kind.
 */
import { http, HttpResponse } from "msw";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import type { Bootstrap } from "../api/wire/proposed";
import { FIXTURE_IDS, fixtureProject } from "./humanGraph";
import { fixtureDecisionId, SERVER_TIME_MS } from "./decisionFixtures";

const HOUR = 3_600_000;
type Fixture = {
  kind: "question"; decision_id: string; decision_revision: string; state: "pending" | "answered";
  project_id: string; workspace_id: string; task_id: string; task_title: string | null; question: string; asked_at_ms: number; expires_at_ms: number;
  answer: string | null; answered_at_ms: number | null; delivery: { kind: "wait" } | { kind: "task_mail"; message_id: string } | null;
};
export const fixtureQuestionId = (n: number) => fixtureDecisionId(0xa00 + n);
const pending = (n: number, task: string, question: string, askedHoursAgo: number): Fixture => ({
  kind: "question", decision_id: fixtureQuestionId(n), decision_revision: "1", state: "pending",
  project_id: fixtureProject.id, workspace_id: fixtureProject.workspace_id, task_id: task, task_title: null, question,
  asked_at_ms: SERVER_TIME_MS - askedHoursAgo * HOUR, expires_at_ms: SERVER_TIME_MS + (24 - askedHoursAgo) * HOUR,
  answer: null, answered_at_ms: null, delivery: null,
});
export function questionFixtures(): Fixture[] {
  return [
    pending(1, FIXTURE_IDS.replay, "Fixture: the replay log has two events with the same sequence number. Should I keep the first, keep the last, or stop and report the conflict?", 1),
    pending(2, FIXTURE_IDS.implement, "Fixture: may I rename `lease_expiry` to `lease_expires_at` in the public record, or must the old field name stay for one release?", 5),
    { ...pending(3, FIXTURE_IDS.lease, "Fixture: which branch should the lease contract change target?", 30), decision_revision: "2", state: "answered",
      answer: "Fixture: target main.", answered_at_ms: SERVER_TIME_MS - 20 * HOUR, delivery: { kind: "task_mail", message_id: fixtureQuestionId(90) } },
  ];
}

export const QUESTION_CAPABILITIES = ["questions.read", "questions.answer"] as const;
export function withQuestionFixtures(bootstrap: Bootstrap): Bootstrap {
  return { ...bootstrap, capabilities: [...bootstrap.capabilities.filter(c => !(QUESTION_CAPABILITIES as readonly string[]).includes(c.name)),
    ...QUESTION_CAPABILITIES.map(name => ({ name, version: "1", enabled: true }))] };
}

/** List, detail and `question.answer` over the fixtures; answers last for the mock session. */
export function questionHandlers() {
  const questions = new Map(questionFixtures().map(q => [q.decision_id, q] as const));
  const answered = new Map<string, { decision: string; answer: string }>();
  const refuse = (status: number, code: string, message: string) => HttpResponse.json({ request_id: "mock", code, message, retryable: false }, { status });
  const operation = (id: string, q: Fixture) => HttpResponse.json({ ...operationFixture, data: { ...operationFixture.data, operation_id: id, disposition: "confirmed",
    scope: { kind: "project", project_id: q.project_id }, subject_refs: [{ type: "decision", id: q.decision_id, revision: "1" }],
    receipt_refs: [{ type: "decision_receipt", id: q.decision_id, revision: q.decision_revision }], affected_entities: [{ type: "decision", id: q.decision_id, revision: q.decision_revision }], recovery: "none" } });
  return [
    http.get("/api/questions/decisions", ({ request }) => {
      const query = new URL(request.url).searchParams;
      const open = query.get("state") !== "closed", project = query.get("project_id");
      const items = [...questions.values()].filter(q => (q.state === "pending") === open && (!project || q.project_id === project));
      return HttpResponse.json({ api_version: "question-inbox-1", server_time_ms: SERVER_TIME_MS, next_cursor: null, items });
    }),
    http.get("/api/questions/decisions/:id", ({ params }) => {
      const q = questions.get(String(params.id));
      return q ? HttpResponse.json({ api_version: "question-inbox-1", server_time_ms: SERVER_TIME_MS, item: q }) : refuse(404, "not_found", "This question does not exist or is not available to you.");
    }),
    http.post("/api/v1/actions", async ({ request }) => {
      const body = (await request.clone().json().catch(() => null)) as { operation_id?: string; kind?: string; subject?: { id?: string; revision?: string }; payload?: { answer?: string; expected_revision?: string } } | null;
      if (body?.kind !== "question.answer" || !body.operation_id) return undefined;
      const q = questions.get(String(body.subject?.id));
      if (!q) return refuse(404, "not_found", "This question does not exist or is not available to you.");
      const replay = answered.get(body.operation_id);
      if (replay) return replay.decision === q.decision_id && replay.answer === body.payload?.answer ? operation(body.operation_id, q) : refuse(409, "id_conflict", "This operation already recorded a different answer.");
      if (q.state !== "pending" || body.payload?.expected_revision !== q.decision_revision) return refuse(409, "stale_revision", "The question changed before this answer was recorded.");
      const next: Fixture = { ...q, state: "answered", decision_revision: "2", answer: String(body.payload?.answer), answered_at_ms: SERVER_TIME_MS + 1_000, delivery: { kind: "wait" } };
      questions.set(q.decision_id, next); answered.set(body.operation_id, { decision: q.decision_id, answer: String(body.payload?.answer) });
      return operation(body.operation_id, next);
    }),
  ];
}
