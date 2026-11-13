import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

export const INTELLIGENCE_PARENTS = ["simple", "standard", "complex", "deep"] as const;
export const INTELLIGENCE_EFFORTS = ["low", "medium", "high", "max"] as const;
export type IntelligenceParentId = typeof INTELLIGENCE_PARENTS[number];
export type IntelligenceEffort = typeof INTELLIGENCE_EFFORTS[number];
export type IntelligenceParent = { id: IntelligenceParentId; description: string };
export type IntelligenceAssignment = { profile_id: string; parent_id: IntelligenceParentId; effort: IntelligenceEffort };
export type IntelligenceStructure = { revision: string; catalog_revision: string; routing_markdown: string; parents: IntelligenceParent[]; assignments: IntelligenceAssignment[] };
export type SaveIntelligenceStructure = Omit<IntelligenceStructure, "revision" | "catalog_revision"> & { operation_id: string; expected_revision: string; expected_catalog_revision: string };
export type IntelligenceStructureSaved = IntelligenceStructure & { operation_id: string; disposition: "saved" | "unchanged" };
export const MAX_ROUTING_POLICY_BYTES = 128 * 1024;
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid intelligence structure response"); }
export function adaptIntelligenceStructure(value: unknown): IntelligenceStructure {
  ensure(isRecord(value) && revision(value.revision) && revision(value.catalog_revision) && text(value.routing_markdown, MAX_ROUTING_POLICY_BYTES));
  ensure(new TextEncoder().encode(value.routing_markdown).length <= MAX_ROUTING_POLICY_BYTES);
  ensure(Array.isArray(value.parents) && value.parents.length === INTELLIGENCE_PARENTS.length && Array.isArray(value.assignments) && value.assignments.length <= 128);
  const parents = new Set<string>(), profiles = new Set<string>(), slots = new Set<string>();
  const parentRows = value.parents.map((parent: unknown): IntelligenceParent => {
    ensure(isRecord(parent) && typeof parent.id === "string" && INTELLIGENCE_PARENTS.includes(parent.id as IntelligenceParentId) && !parents.has(parent.id) && text(parent.description, 2000));
    parents.add(parent.id); return { id: parent.id as IntelligenceParentId, description: parent.description };
  });
  const assignments = value.assignments.map((assignment: unknown): IntelligenceAssignment => {
    ensure(isRecord(assignment) && text(assignment.profile_id, 96) && assignment.profile_id.length > 0 && typeof assignment.parent_id === "string" && parents.has(assignment.parent_id) && typeof assignment.effort === "string" && INTELLIGENCE_EFFORTS.includes(assignment.effort as IntelligenceEffort));
    const slot = `${assignment.parent_id}:${assignment.effort}`;
    ensure(!profiles.has(assignment.profile_id) && !slots.has(slot)); profiles.add(assignment.profile_id); slots.add(slot);
    return { profile_id: assignment.profile_id, parent_id: assignment.parent_id as IntelligenceParentId, effort: assignment.effort as IntelligenceEffort };
  });
  return { revision: value.revision, catalog_revision: value.catalog_revision, routing_markdown: value.routing_markdown, parents: parentRows, assignments };
}
function saved(value: unknown, operationId: string): IntelligenceStructureSaved {
  ensure(isRecord(value) && value.operation_id === operationId && (value.disposition === "saved" || value.disposition === "unchanged"));
  return { ...adaptIntelligenceStructure(value), operation_id: operationId, disposition: value.disposition };
}
export async function readIntelligenceStructure(signal?: AbortSignal) { return adaptIntelligenceStructure(await apiGet<unknown>("/api/settings/intelligence/structure", signal)); }
export async function saveIntelligenceStructure(request: SaveIntelligenceStructure) { return saved(await apiSend<unknown>("POST", "/api/settings/intelligence/structure", request), request.operation_id); }
export async function inspectIntelligenceStructureSave(operationId: string) { return saved(await apiGet<unknown>(`/api/settings/intelligence/structure/operations/${encodeURIComponent(operationId)}`), operationId); }
