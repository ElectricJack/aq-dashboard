import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

export const INTERNAL_WORK_PURPOSES = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"] as const;
export type InternalWorkPurpose = typeof INTERNAL_WORK_PURPOSES[number];
export type InternalWorkSettings = {
  revision: string; catalog_revision: string; default_profile_id: string | null;
  overrides: Partial<Record<InternalWorkPurpose, string>>; purposes: InternalWorkPurpose[];
};
export type SaveInternalWork = Pick<InternalWorkSettings, "default_profile_id" | "overrides"> & { operation_id: string; expected_revision: string; expected_catalog_revision: string };
export type InternalWorkSaved = InternalWorkSettings & { operation_id: string; disposition: "saved" | "unchanged" };
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
const profileId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128;
const purpose = (value: unknown): value is InternalWorkPurpose => INTERNAL_WORK_PURPOSES.includes(value as InternalWorkPurpose);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid internal work settings response"); }
export function adaptInternalWork(value: unknown): InternalWorkSettings {
  ensure(isRecord(value) && revision(value.revision) && revision(value.catalog_revision));
  ensure(value.default_profile_id === null || profileId(value.default_profile_id));
  ensure(isRecord(value.overrides) && Array.isArray(value.purposes) && value.purposes.length <= INTERNAL_WORK_PURPOSES.length && value.purposes.every(purpose));
  const overrides: Partial<Record<InternalWorkPurpose, string>> = {};
  for (const [key, id] of Object.entries(value.overrides)) { ensure(purpose(key) && profileId(id)); overrides[key] = id; }
  return { revision: value.revision, catalog_revision: value.catalog_revision, default_profile_id: value.default_profile_id as string | null, overrides, purposes: value.purposes as InternalWorkPurpose[] };
}
function saved(value: unknown, operationId: string): InternalWorkSaved {
  ensure(isRecord(value) && value.operation_id === operationId && (value.disposition === "saved" || value.disposition === "unchanged"));
  return { ...adaptInternalWork(value), operation_id: operationId, disposition: value.disposition };
}
export async function readInternalWorkSettings(signal?: AbortSignal) { return adaptInternalWork(await apiGet<unknown>("/api/settings/internal-work", signal)); }
export async function saveInternalWorkSettings(request: SaveInternalWork) { return saved(await apiSend<unknown>("POST", "/api/settings/internal-work", request), request.operation_id); }
export async function inspectInternalWorkSave(operationId: string) { return saved(await apiGet<unknown>(`/api/settings/internal-work/operations/${encodeURIComponent(operationId)}`), operationId); }
