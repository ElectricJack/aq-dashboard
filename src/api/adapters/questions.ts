import { canonicalUuid, timestampMs, ContractError, isRecord } from "./contract";

/**
 * F5 agent questions as the decision inbox reads them. The read shape is the live
 * `question-inbox-1` family in contracts/live/dashboard-read-g2/schema.json (aq-server
 * PR #89). It is optional: servers that do not advertise `questions.read` are never asked.
 * The server keeps expired questions in the open list as `pending`; see `isQuestionExpired`.
 */
export const QUESTIONS_ROOT = "/api/questions/decisions";
export const QUESTIONS_READ = "questions.read";
export const QUESTIONS_ANSWER = "questions.answer";
/** Server limit on one answer (`MAX_ANSWER_BYTES`, UTF-8 bytes). */
export const MAX_ANSWER_BYTES = 16_000;
const MAX_QUESTION_BYTES = 4096;
const MAX_TITLE_BYTES = 4096;

export type QuestionDelivery = { kind: "wait" } | { kind: "task_mail"; messageId: string };
export type QuestionSummary = {
  decisionId: string; revision: string; state: "pending" | "answered";
  projectId: string; workspaceId: string; taskId: string; taskTitle: string | null;
  question: string; askedAt: number; expires: number;
  answer: string | null; answeredAt: number | null; delivery: QuestionDelivery | null;
};
export type QuestionPage = { items: QuestionSummary[]; cursor: string | null; serverTime: number };
export type QuestionRead = { item: QuestionSummary; serverTime: number };

function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid question response"); }
const revision = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v);
const bytes = (v: string) => new TextEncoder().encode(v).length;
const prose = (v: unknown, limit: number): v is string => typeof v === "string" && v.trim().length > 0 && bytes(v) <= limit;

/** A pending question whose `expires_at_ms` is before the server's current time (the server still lists it as pending). */
export function isQuestionExpired(q: Pick<QuestionSummary, "state" | "expires">, serverNowMs: number): boolean {
  return q.state === "pending" && q.expires < serverNowMs;
}

function answerFields(v: Record<string, unknown>): Pick<QuestionSummary, "answer" | "answeredAt" | "delivery"> {
  if (v.state === "pending") {
    ensure(v.answer === null && v.answered_at_ms === null && v.delivery === null);
    return { answer: null, answeredAt: null, delivery: null };
  }
  ensure(prose(v.answer, MAX_ANSWER_BYTES) && timestampMs(v.answered_at_ms));
  ensure(v.decision_revision !== "1" && isRecord(v.delivery));
  const delivery = v.delivery;
  if (delivery.kind === "wait") {
    return { answer: v.answer, answeredAt: v.answered_at_ms, delivery: { kind: "wait" } };
  }
  ensure(delivery.kind === "task_mail" && canonicalUuid(delivery.message_id));
  return { answer: v.answer, answeredAt: v.answered_at_ms, delivery: { kind: "task_mail", messageId: delivery.message_id } };
}

function taskTitle(value: unknown): string | null {
  if (value == null) return null;
  ensure(typeof value === "string" && bytes(value) <= MAX_TITLE_BYTES);
  return value.trim() ? value : null;
}

function question(v: unknown): QuestionSummary {
  ensure(isRecord(v) && v.kind === "question");
  ensure(canonicalUuid(v.decision_id) && revision(v.decision_revision));
  ensure(v.state === "pending" || v.state === "answered");
  ensure(canonicalUuid(v.project_id));
  ensure(canonicalUuid(v.workspace_id));
  ensure(canonicalUuid(v.task_id));
  ensure(prose(v.question, MAX_QUESTION_BYTES));
  ensure(timestampMs(v.asked_at_ms) && timestampMs(v.expires_at_ms));
  return {
    decisionId: v.decision_id, revision: v.decision_revision, state: v.state, projectId: v.project_id, workspaceId: v.workspace_id, taskId: v.task_id,
    taskTitle: taskTitle(v.task_title),
    question: v.question, askedAt: v.asked_at_ms, expires: v.expires_at_ms,
    ...answerFields(v),
  };
}

function validCursor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 4096);
}

function questionHeader(raw: unknown): asserts raw is Record<string, unknown> & {server_time_ms: number} {
  ensure(isRecord(raw) && raw.api_version === "question-inbox-1" && timestampMs(raw.server_time_ms));
}

export function adaptQuestions(raw: unknown, open: boolean, project?: string): QuestionPage {
  questionHeader(raw);
  ensure(Array.isArray(raw.items) && raw.items.length <= 50);
  ensure(validCursor(raw.next_cursor));
  const items = raw.items.map(question);
  ensure(new Set(items.map(i => i.decisionId)).size === items.length);
  ensure(items.every(i => (i.state === "pending") === open && (!project || i.projectId === project)));
  return { items, cursor: raw.next_cursor, serverTime: raw.server_time_ms };
}

export function adaptQuestion(raw: unknown, expected: string): QuestionRead {
  questionHeader(raw);
  const item = question(raw.item);
  ensure(item.decisionId === expected);
  return { item, serverTime: raw.server_time_ms };
}

