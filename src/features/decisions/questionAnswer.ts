import { MAX_ANSWER_BYTES, type QuestionSummary } from "../../api/adapters/questions";
import type { FrozenAction } from "../actions/actionClient";

/**
 * G1b `question.answer` (dashboard-actions-1): the owner answers one agent question at
 * its exact decision revision. The subject is the decision at that revision, the
 * single expected version is `decision`, and the strict payload carries only the
 * operation, the expected revision and the answer text.
 */
export function freezeQuestionAnswer(q: QuestionSummary, text: string): FrozenAction {
  const answer = text.trim();
  if (!answer) throw new Error("Write an answer before sending.");
  if (new TextEncoder().encode(answer).length > MAX_ANSWER_BYTES) throw new Error("Please shorten the answer before sending.");
  const id = crypto.randomUUID();
  const subject = { type: "decision", id: q.decisionId, revision: q.revision };
  const bytes = JSON.stringify({ operation_id: id, kind: "question.answer", subject, expected_versions: { decision: q.revision },
    payload: { operation_id: id, expected_revision: q.revision, answer } });
  return Object.freeze({ id, bytes, kind: "question.answer", subject: Object.freeze(subject), project: q.projectId });
}
