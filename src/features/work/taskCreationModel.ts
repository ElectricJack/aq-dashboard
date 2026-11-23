import { isRecord } from "../../api/adapters/contract";
import { ApiError, apiGet } from "../../api/client";
import { adaptGraphDetail, type GraphNode } from "../../api/adapters/humanGraph";
import { graphPath } from "../../api/humanGraphReads";
import {
  adaptTaskOperation,
  validateTitle,
  validateTaskDraft,
  type FrozenTaskCreate,
  type TaskDraft,
  type TaskOperation,
} from "../../api/adapters/taskCreate";
import { taskOperationRequest } from "../../api/taskCreateClient";
import type { QueryClient } from "@tanstack/react-query";

export const blankTask: TaskDraft = { title: "", body: "", acceptance_criteria: "", task_state: "draft" };
function bounded(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function optionalText(value: unknown, limit: number) {
  return value === undefined || bounded(value, limit);
}
export function validDraft(value: unknown): value is TaskDraft {
  if (!isRecord(value)) return false;
  if (!bounded(value.title, 1024)) return false;
  if (typeof value.body !== "string" || typeof value.acceptance_criteria !== "string") return false;
  if (value.task_state !== "draft" && value.task_state !== "active") return false;
  return optionalText(value.role, 128) && optionalText(value.storyPoints, 16);
}
export type CreateAttempt = { kind: "lookup" | "submit" | "recover"; id: string; intent?: FrozenTaskCreate };
export async function requestCreation(
  attempt: CreateAttempt,
  project: string,
  actor: string,
  signal: AbortSignal,
) {
  const { kind, id, intent } = attempt;
  const path =
    kind === "submit"
      ? graphPath(project, "task")
      : `/api/human/operations/${encodeURIComponent(id)}${kind === "recover" ? "/recover" : ""}`;
  const bytes = kind === "submit" ? intent!.bytes : kind === "recover" ? "{}" : undefined;
  const raw = await taskOperationRequest(kind === "lookup" ? "GET" : "POST", path, bytes, signal);
  return adaptTaskOperation(raw, {
    operationId: id,
    project,
    actor,
    ...(intent ? { digest: intent.digest } : {}),
  });
}
export async function readCreatedTask(project: string, value: TaskOperation, signal: AbortSignal) {
  const raw = await apiGet<unknown>(graphPath(project, "task", value.task_id), signal);
  const record = adaptGraphDetail(raw, project, "task", value.task_id);
  if (record.project.workspace_id !== value.receipt?.workspace_id) throw new Error("Task workspace changed");
  return record.data;
}
const taskLists = new Set([
  "human-graph-list",
  "human-graph-gantt",
  "all-project-work",
  "overview-task-contributions",
]);
export function refreshTaskLists(client: QueryClient, principal: string) {
  void client.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return key[0] === "aq" && key[1] === principal && taskLists.has(String(key[4]));
    },
  });
}
export function invalidSubmission(kind: CreateAttempt["kind"], reason: ApiError) {
  if (kind !== "submit" || reason.kind !== "http") return false;
  return [400, 413, 422].includes(reason.status ?? 0);
}
export function terminalOperation(status: TaskOperation | null) {
  return status && ["conflict", "rejected", "confirmed"].includes(status.state);
}
function matching<T>(value: T | null, id: string | undefined, operation: string | undefined) {
  return id === operation ? value : null;
}
export function creationSnapshot(state: {
  selected?: string;
  internal?: string;
  intent: FrozenTaskCreate | null;
  statusValue: TaskOperation | null;
  task: GraphNode | null;
}) {
  const { selected, internal, intent, statusValue, task } = state;
  const cached = intent?.operationId;
  const operation = selected ?? (internal === cached ? cached : undefined);
  const frozen = matching(intent, cached, operation);
  const status = matching(statusValue, statusValue?.operation_id, operation);
  const created = status?.state === "confirmed" ? matching(task, task?.id, operation) : null;
  return { operation, frozen, status, created };
}
export function missingOperation(kind: CreateAttempt["kind"], error: unknown): error is ApiError {
  return kind === "lookup" && error instanceof ApiError && error.status === 404;
}
export function draftProblem(draft: TaskDraft) {
  return validateTitle(draft.title.trim(), "bytes") ?? validateTaskDraft(draft);
}
