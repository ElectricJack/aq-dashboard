import { ContractError } from "../../api/adapters/contract";
import { validGraphId } from "../../api/adapters/humanGraph";
import { validateResultPayload, type ResultComment, type ResultDetail } from "../../api/adapters/resultsFeedback";
import type { Envelope, FeedbackDraft as CreateRequest, FeedbackLink, FeedbackTaskStatus } from "../../api/wire/resultsFeedback";

export type FeedbackFields = {
  commentId: string; mode: "create" | "link"; title: string; description: string;
  criteria: string; project: string; parent: string; existing: string; artifacts: string[];
};
export type FeedbackRequest = CreateRequest | FeedbackLink;

export function initialFields(detail: ResultDetail, comments: ResultComment[], initial?: string): FeedbackFields {
  const commentId = initial ?? comments[0]?.id ?? "";
  return { commentId, mode: "create", title: "Review result feedback",
    description: comments.find(comment => comment.id === commentId)?.body ?? "", criteria: "",
    project: detail.result.project_id, parent: "", existing: "", artifacts: [] };
}

export function recoveredFields(origin: CreateRequest): Partial<FeedbackFields> {
  return { commentId: origin.comment_id, title: origin.title, description: origin.description,
    criteria: origin.acceptance_criteria, project: origin.project_id, parent: origin.parent_id ?? "",
    artifacts: origin.artifacts.map(artifact => artifact.artifact_id) };
}

export function feedbackRequest(detail: ResultDetail, comment: ResultComment, fields: FeedbackFields, revision?: string): FeedbackRequest {
  const shared = {
    operation_id: crypto.randomUUID(), expected_version: comment.thread_version, thread_id: comment.thread_id,
    comment_id: comment.id, comment_revision: comment.revision, result_id: detail.result.id,
    revision: detail.revision.revision, artifacts: detail.assessment.artifacts.filter(pin => fields.artifacts.includes(pin.artifact_id)),
  };
  if (fields.mode === "link") {
    const link = { ...shared, project_id: detail.result.project_id, task_id: fields.existing };
    validateResultPayload("FeedbackLink", link);
    return link;
  }
  const draft = { ...shared, project_id: fields.project, expected_project_revision: revision!,
    title: fields.title, description: fields.description, acceptance_criteria: fields.criteria,
    ...(fields.parent ? { parent_id: fields.parent } : {}) };
  validateResultPayload("FeedbackDraft", draft);
  return draft;
}

export function readFeedbackReceipt(raw: unknown, detail: ResultDetail) {
  validateResultPayload("Envelope", raw);
  const { scope, data } = raw as Envelope;
  if (scope.kind !== "project" || scope.project_id !== detail.result.project_id) {
    throw new ContractError("Feedback receipt scope changed");
  }
  return data;
}

export function checkRecoveredOrigin(origin: CreateRequest, detail: ResultDetail) {
  if (origin.result_id !== detail.result.id || origin.revision !== detail.revision.revision) {
    throw new ContractError("Feedback origin changed");
  }
}

export function checkFeedbackPins(data: FeedbackTaskStatus, id: string, detail: ResultDetail, origin: FeedbackRequest) {
  function requirePin(match: boolean) {
    if (!match) throw new ContractError("Feedback receipt pins changed");
  }
  requirePin(data.operation_id === id);
  requirePin(data.task_id === id);
  requirePin(data.result_id === detail.result.id);
  requirePin(data.revision === detail.revision.revision);
  const actual: Record<string, unknown> = data.origin;
  for (const [key, value] of Object.entries(origin)) requirePin(JSON.stringify(value) === JSON.stringify(actual[key]));
}

const operationKey = "feedback_operation", resultKey = "feedback_result", revisionKey = "feedback_revision";
export function retainedFeedback(params: URLSearchParams, detail: ResultDetail) {
  if (params.get(resultKey) !== detail.result.id || params.get(revisionKey) !== detail.revision.revision) return;
  const id = params.get(operationKey);
  if (id && validGraphId(id)) return id;
}

export function feedbackParams(params: URLSearchParams, operation?: { id: string; detail: ResultDetail }) {
  const next = new URLSearchParams(params);
  if (operation) {
    next.set(operationKey, operation.id);
    next.set(resultKey, operation.detail.result.id);
    next.set(revisionKey, operation.detail.revision.revision);
  } else {
    for (const key of [operationKey, resultKey, revisionKey]) next.delete(key);
  }
  return next;
}

export function checkCommentGuard(comments: ResultComment[] | undefined, origin: FeedbackRequest | null) {
  if (!comments || !origin) return;
  const pinned = comments.find(comment => comment.id === origin.comment_id);
  if (pinned?.revision !== origin.comment_revision) throw new Error("Comment changed");
}
