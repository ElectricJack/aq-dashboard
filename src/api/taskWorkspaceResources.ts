import { apiGet, apiSend } from "./client";
import { boundedList, boundedUtf8, canonicalUuid, ContractError, isRecord, positiveInteger } from "./adapters/contract";

export const TASK_WORKSPACE_RESOURCES = "tasks.workspace.resources";
export type WorkspaceAccess = "read" | "write";
type WorkspaceState = "pending" | "approved" | "denied";
export type WorkspaceSource = {
  target_project_id: string;
  repository_id: string;
  binding_generation: number;
  project_revision: number;
  commit_oid: string;
  access: WorkspaceAccess;
  state: WorkspaceState;
};
export type WorkspaceRequest = WorkspaceSource & { home_project_id: string; task_id: string };
export type WorkspaceResources = { sources: WorkspaceSource[]; services: { service: "postgres" }[] };
export type ResourceRequest = { target_project_id: string; access: WorkspaceAccess } | { service: "postgres" };
export type WorkspaceDecision = Pick<WorkspaceSource, "project_revision" | "commit_oid" | "access"> & {
  decision: "approved" | "denied";
};

export const MAX_WORKSPACE_PROJECTS = 16;
const MAX_INCOMING = 256;
export function isResourceRequest(value: unknown): value is ResourceRequest {
  if (!isRecord(value)) return false;
  const fields = Object.keys(value);
  return fields.length === 1 && postgres(value) ||
    fields.length === 2 && canonicalUuid(value.target_project_id) &&
      (value.access === "read" || value.access === "write");
}
function source(value: unknown): value is WorkspaceSource {
  if (!isRecord(value)) return false;
  return canonicalUuid(value.target_project_id) && boundedUtf8(value.repository_id, 512) &&
    positiveInteger(value.binding_generation) && positiveInteger(value.project_revision) &&
    typeof value.commit_oid === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.commit_oid) &&
    (value.access === "read" || value.access === "write") &&
    (value.state === "pending" || value.state === "approved" || value.state === "denied");
}

function postgres(value: unknown): value is { service: "postgres" } {
  return isRecord(value) && value.service === "postgres";
}

export function adaptWorkspaceResources(value: unknown): WorkspaceResources {
  if (!isRecord(value) || !boundedList(value.sources, MAX_WORKSPACE_PROJECTS, source) || !boundedList(value.services, 1, postgres)) {
    throw new ContractError("Invalid task workspace resources");
  }
  return { sources: value.sources as WorkspaceSource[], services: value.services as WorkspaceResources["services"] };
}

function incoming(value: unknown, target: string): value is WorkspaceRequest {
  return isRecord(value) && canonicalUuid(value.home_project_id) && canonicalUuid(value.task_id) && source(value) &&
    value.target_project_id === target && value.state === "pending";
}

function projectPath(project: string) {
  return `/api/projects/${encodeURIComponent(project)}`;
}
function taskPath(home: string, task: string) {
  return `${projectPath(home)}/tasks/${encodeURIComponent(task)}/workspace`;
}

export async function readWorkspaceResources(home: string, task: string, signal?: AbortSignal) {
  return adaptWorkspaceResources(await apiGet<unknown>(taskPath(home, task), signal));
}

export async function requestWorkspaceResource(home: string, task: string, request: ResourceRequest) {
  return adaptWorkspaceResources(await apiSend<unknown>("POST", taskPath(home, task), request));
}

export async function readWorkspaceRequests(target: string, signal?: AbortSignal) {
  const value = await apiGet<unknown>(`${projectPath(target)}/workspace-requests`, signal);
  if (!isRecord(value) || typeof value.has_more !== "boolean" ||
      !boundedList(value.sources, MAX_INCOMING, item => incoming(item, target))) {
    throw new ContractError("Invalid incoming workspace requests");
  }
  return { sources: value.sources as WorkspaceRequest[], hasMore: value.has_more };
}

export async function decideWorkspaceRequest(request: WorkspaceRequest, decision: WorkspaceDecision["decision"]) {
  const { target_project_id, home_project_id, task_id, project_revision, commit_oid, access } = request;
  const path = `${projectPath(target_project_id)}/workspace-requests/${encodeURIComponent(home_project_id)}/${encodeURIComponent(task_id)}/decision`;
  return adaptWorkspaceResources(await apiSend<unknown>("POST", path, { decision, project_revision, commit_oid, access }));
}
