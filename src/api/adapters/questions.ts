import { ContractError, isRecord } from "./contract";

/**
 * F5 agent questions as the decision inbox reads them. The read shape is PROPOSED
 * (contracts/proposed/question-inbox.json): aq-server main records question decisions
 * and accepts the `question.answer` action, but does not yet serve this human read, so
 * live bootstraps leave `questions.read` absent and nothing here is requested.
 */
export const QUESTIONS_ROOT = "/api/questions/decisions";
export const QUESTIONS_READ = "questions.read";
export const QUESTIONS_ANSWER = "questions.answer";
/** Server limit on one answer (`MAX_ANSWER_BYTES`, UTF-8 bytes). */
export const MAX_ANSWER_BYTES = 16_000;
const MAX_QUESTION_BYTES = 4096;

export type QuestionDelivery = { kind: "wait" } | { kind: "task_mail"; messageId: string };
export type QuestionSummary = {
  decisionId: string; revision: string; state: "pending" | "answered";
  projectId: string; workspaceId: string; taskId: string;
  question: string; askedAt: number; expires: number;
  answer: string | null; answeredAt: number | null; delivery: QuestionDelivery | null;
};
export type QuestionPage = { items: QuestionSummary[]; cursor: string | null; serverTime: number };
export type QuestionRead = { item: QuestionSummary; serverTime: number };

function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid question response"); }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v); }
function time(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000; }
const revision = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v);
const bytes = (v: string) => new TextEncoder().encode(v).length;
const prose = (v: unknown, limit: number): v is string => typeof v === "string" && v.trim().length > 0 && bytes(v) <= limit;

function question(v: unknown): QuestionSummary {
  ensure(isRecord(v) && v.kind === "question" && uuid(v.decision_id) && revision(v.decision_revision) && (v.state === "pending" || v.state === "answered"));
  ensure(uuid(v.project_id) && uuid(v.workspace_id) && uuid(v.task_id) && prose(v.question, MAX_QUESTION_BYTES) && time(v.asked_at_ms) && time(v.expires_at_ms));
  let delivery: QuestionDelivery | null = null;
  if (v.state === "pending") ensure(v.answer === null && v.answered_at_ms === null && v.delivery === null);
  else {
    ensure(prose(v.answer, MAX_ANSWER_BYTES) && time(v.answered_at_ms) && v.decision_revision !== "1" && isRecord(v.delivery));
    const d = v.delivery;
    ensure(d.kind === "wait" || (d.kind === "task_mail" && uuid(d.message_id)));
    delivery = d.kind === "wait" ? { kind: "wait" } : { kind: "task_mail", messageId: String(d.message_id) };
  }
  return {
    decisionId: v.decision_id, revision: v.decision_revision, state: v.state, projectId: v.project_id, workspaceId: v.workspace_id, taskId: v.task_id,
    question: v.question, askedAt: v.asked_at_ms, expires: v.expires_at_ms,
    answer: v.state === "answered" ? String(v.answer) : null, answeredAt: v.state === "answered" ? Number(v.answered_at_ms) : null, delivery,
  };
}

export function adaptQuestions(raw: unknown, open: boolean, project?: string): QuestionPage {
  ensure(isRecord(raw) && raw.api_version === "question-inbox-1" && time(raw.server_time_ms) && Array.isArray(raw.items) && raw.items.length <= 50);
  ensure(raw.next_cursor === null || (typeof raw.next_cursor === "string" && raw.next_cursor.length > 0 && raw.next_cursor.length <= 4096));
  const items = raw.items.map(question);
  ensure(new Set(items.map(i => i.decisionId)).size === items.length);
  ensure(items.every(i => (i.state === "pending") === open && (!project || i.projectId === project)));
  return { items, cursor: raw.next_cursor, serverTime: raw.server_time_ms };
}

export function adaptQuestion(raw: unknown, expected: string): QuestionRead {
  ensure(isRecord(raw) && raw.api_version === "question-inbox-1" && time(raw.server_time_ms));
  const item = question(raw.item);
  ensure(item.decisionId === expected);
  return { item, serverTime: raw.server_time_ms };
}

