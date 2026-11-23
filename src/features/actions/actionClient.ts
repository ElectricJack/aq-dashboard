import { ApiError, isErrorEnvelope } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { type GraphEnvelope, type GraphNode } from "../../api/adapters/humanGraph";

import { adaptActionOperation, type ActionOperation, type FrozenAction } from "./actionOperation";
export { adaptActionOperation, type ActionOperation, type EntityRef, type FrozenAction } from "./actionOperation";

export const actionLabels = {
  "task.edit": "Edit task", "task.reprioritize": "Reprioritize", "task.role.set": "Change role", "task.cancel": "Cancel task", "task.delete": "Delete task", "task.retry": "Retry attempt",
  "task.activate": "Activate task", "task.activate.subtree": "Activate subtree",
  "task.dependency.add": "Add dependency", "task.dependency.remove": "Remove dependency",
  "task.route.set": "Set route", "task.route.clear": "Clear route",
  "knowledge.author": "Add record", "knowledge.correct": "Correct record",
  "knowledge.verify": "Verify record", "knowledge.retire": "Retire record",
  "knowledge.restore": "Restore record",
} as const;
export const actionCapability = (kind: ActionKind): string => ({"task.activate":"tasks.activate","task.activate.subtree":"tasks.activate.subtree","task.edit":"tasks.edit","task.reprioritize":"tasks.reprioritize","task.role.set":"tasks.edit","task.cancel":"tasks.cancel","task.delete":"tasks.delete","task.retry":"tasks.retry","task.dependency.add":"tasks.dependencies.add","task.dependency.remove":"tasks.dependencies.remove","task.route.set":"tasks.route","task.route.clear":"tasks.route"} as Partial<Record<ActionKind,string>>)[kind] ?? kind;
export type ActionKind = keyof typeof actionLabels;
/* `task.activate` follows the typed task kinds' bootstrap naming (`tasks.cancel`, `tasks.retry`, `tasks.delete`): `tasks.activate@1`. */
/* `task.role.set` has no capability of its own: AQ admits it under the same task-edit grant as `task.edit`, so it follows `tasks.edit`. */
/** Document actions for a knowledge record's lifecycle: a retired (or deleted) record is only restored, never edited or retired again. */
export const knowledgeActionKinds = (node: Pick<GraphNode, "retired" | "deleted"> | undefined): ActionKind[] =>
  node?.retired || node?.deleted ? ["knowledge.restore"] : ["knowledge.correct", "knowledge.verify", "knowledge.retire"];
/** Human label for a knowledge content type ("standard_operating" → "Standard operating"). */
export const knowledgeCategoryLabel = (value: string | null | undefined) => value ? value.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()) : "Uncategorized";
export type ActionContext = { project: GraphEnvelope<unknown>["project"]; data?: GraphNode };
function actionSubject(kind: ActionKind, context: ActionContext) {
  if (kind === "knowledge.author") return { type: "project", id: context.project.id, revision: context.project.revision };
  const node = context.data!;
  return { type: kind.startsWith("task.") ? "task" : "knowledge", id: node.id, revision: node.version };
}

export function freezeAction(kind: ActionKind, context: ActionContext, fields: Record<string, unknown>, reason?: string): FrozenAction {
  const id = crypto.randomUUID();
  const subject = actionSubject(kind, context);
  const versionKey = kind === "knowledge.author" ? "expected_project_revision" : "expected_version";
  const body = {
    operation_id: id, kind, subject, expected_versions: { [subject.type]: subject.revision },
    ...(reason ? { reason } : {}), payload: { ...fields, operation_id: id, project_id: context.project.id, [versionKey]: subject.revision },
  };
  const bytes = JSON.stringify(body);
  if (new TextEncoder().encode(bytes).length > 65536) throw new Error("This request is too large. Shorten the document or labels.");
  return Object.freeze({ id, bytes, kind, subject });
}
function fetchAction(intent: FrozenAction, lookup: boolean, signal: AbortSignal) {
  const shared = { credentials: "same-origin" as const, signal };
  if (lookup) return fetch(`/api/v1/operations/${encodeURIComponent(intent.id)}`, {
    ...shared, method: "GET", headers: { Accept: "application/json" },
  });
  return fetch("/api/v1/actions", { ...shared, method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-AQ-Request": "1" }, body: intent.bytes,
  });
}

function requestSignal(signal: AbortSignal | undefined) {
  const deadline = AbortSignal.timeout(6000);
  return AbortSignal.any(signal ? [deadline, signal] : [deadline]);
}

function httpFailure(response: Response, raw: unknown, lookup: boolean) {
  return new ApiError("http", "Action response unavailable", {
    status: response.status, effectUnknown: !lookup && (response.ok || response.status >= 500),
    ...(isErrorEnvelope(raw) ? { envelope: raw } : {}),
  });
}

async function readActionResponse(response: Response, intent: FrozenAction, lookup: boolean) {
  const raw: unknown = await response.json().catch(() => undefined);
  if (isRecord(raw) && raw.api_version === "dashboard-actions-1") return adaptActionOperation(raw, intent);
  throw httpFailure(response, raw, lookup);
}

/** Frozen bytes cross the fetch boundary unchanged, including deliberate retries. */
export async function actionRequest(intent:FrozenAction, lookup=false, signal?:AbortSignal):Promise<ActionOperation> {
  try {
    const response = await fetchAction(intent, lookup, requestSignal(signal));
    return await readActionResponse(response, intent, lookup);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ContractError) throw error;
    throw new ApiError("transport", "Action outcome is not known", { effectUnknown: !lookup });
  }
}
