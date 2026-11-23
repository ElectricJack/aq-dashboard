import { apiGet, apiSend, ApiError } from "../../api/client";
import { isRecord } from "../../api/adapters/contract";
import type { ProjectBindingView } from "../../api/adapters/projectBindings";

export type ProjectIntent = { operation: string; revision: number; enabled: boolean; body: Record<string, unknown> };

export function isProjectIntent(value: unknown): value is ProjectIntent | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return typeof value.operation === "string" && typeof value.revision === "number"
    && typeof value.enabled === "boolean" && isRecord(value.body);
}

export function projectIntent(project: ProjectBindingView, enabled: boolean): ProjectIntent {
  const operation = crypto.randomUUID();
  const body = {
    operation_id: operation,
    expected_revision: project.revision,
    ...(enabled ? { binding: { ...project.binding, enabled: true } } : {}),
  };
  return { operation, revision: project.revision, enabled, body };
}

function projectRecord(raw: unknown, projectId: string) {
  if (!isRecord(raw) || !isRecord(raw.binding)) return null;
  const { binding, revision } = raw;
  if (binding.project_id !== projectId) return null;
  if (typeof binding.enabled !== "boolean" || typeof revision !== "number") return null;
  return { enabled: binding.enabled, revision };
}

async function projectReceipt(projectId: string, saved: ProjectIntent) {
  const path = `/api/projects/${projectId}${saved.enabled ? "" : "/disable"}`;
  const raw = await apiSend<unknown>("POST", path, saved.body, AbortSignal.timeout(8000));
  if (!isRecord(raw) || raw.operation_id !== saved.operation) return null;
  return projectRecord(raw.record, projectId);
}

export async function submitProjectIntent(projectId: string, saved: ProjectIntent) {
  const record = await projectReceipt(projectId, saved);
  const confirmed = record?.enabled === saved.enabled && record.revision === saved.revision + 1;
  if (!confirmed) throw Error("Unconfirmed project operation");
}

export async function readProjectState(projectId: string) {
  const raw = await apiGet<unknown>(`/api/projects/${projectId}`, AbortSignal.timeout(8000));
  const record = projectRecord(raw, projectId);
  if (!record) throw Error("Invalid project state");
  return record.enabled ? "started" : "stopped";
}

export function projectRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && [400, 401, 403, 404, 409, 413, 422].includes(error.status ?? 0);
}
