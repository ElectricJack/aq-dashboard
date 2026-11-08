import { ContractError, isRecord } from "./contract";
export const PROJECT_PAGE_SIZE = 25;
export type ProjectBindingView = {
  id: string; name: string; revision: number; enabled: boolean;
  repositoryId: string; repositoryGeneration: number; workspaceId: string; catalogDigest: string;
  agents: string[]; intelligence: string[]; execution: string[]; environments: string[]; workerGroups: string[]; nodeIds: string[]; enrolledNodes: boolean;
  validation: { repository: string; graph: string; recordedAt: string; observedAt: string; expiresAt: string };
};
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid project binding page"); }
function positive(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v > 0; }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000"; }
function label(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f]/.test(v); }
function labels(v: unknown, empty = false): string[] { ensure(Array.isArray(v) && (empty || v.length > 0) && v.length <= 32 && v.every(label) && new Set(v).size === v.length); return v; }
function timestamp(v: unknown): string { ensure(positive(v) && v <= 8640000000000000); return new Date(v).toISOString(); }
export function validationLabel(v: string): string {
  return ({ verified: "Verified", absent: "Absent", stale: "Stale", forbidden: "Forbidden", unavailable: "Unavailable", unsupported: "Unsupported" } as Record<string, string>)[v] ?? "Unknown";
}
export function adaptProjectBindings(raw: unknown, after: string | null) {
  ensure(isRecord(raw) && Array.isArray(raw.items) && raw.items.length <= PROJECT_PAGE_SIZE && (raw.next_cursor === null || uuid(raw.next_cursor)));
  let previous = after;
  const items: ProjectBindingView[] = raw.items.map((row: unknown) => {
    ensure(isRecord(row) && positive(row.revision) && isRecord(row.binding) && isRecord(row.validation));
    const b = row.binding, v = row.validation;
    ensure(b.schema_version === 1 && uuid(b.project_id) && (!previous || b.project_id > previous) && label(b.name) && typeof b.enabled === "boolean");
    ensure(uuid(b.repository_id) && uuid(b.graph_workspace_id) && positive(b.repository_binding_generation) && typeof b.catalog_digest === "string" && /^[0-9a-f]{64}$/.test(b.catalog_digest));
    ensure(v.repository_generation === b.repository_binding_generation && v.repository_id === b.repository_id && v.graph_workspace_id === b.graph_workspace_id && v.repository_adapter_reference === b.repository_adapter_reference && v.graph_adapter_reference === b.graph_adapter_reference);
    ensure(label(v.repository) && label(v.graph));
    const observedAt = timestamp(v.observed_at_ms), expiresAt = timestamp(v.expires_at_ms);
    ensure((v.expires_at_ms as number) > (v.observed_at_ms as number));
    ensure(Array.isArray(b.allowed_node_ids) && b.allowed_node_ids.length <= 256 && b.allowed_node_ids.every(uuid) && new Set(b.allowed_node_ids).size === b.allowed_node_ids.length);
    const workerGroups = labels(b.allowed_worker_groups, true);
    // The server omits the field when it is true (default on), so only an explicit false turns it off.
    const enrolledNodes = b.allow_enrolled_nodes !== false;
    ensure(workerGroups.length > 0 || b.allowed_node_ids.length > 0 || enrolledNodes);
    previous = b.project_id;
    return { id: b.project_id, name: b.name, revision: row.revision, enabled: b.enabled, repositoryId: b.repository_id, repositoryGeneration: b.repository_binding_generation,
      workspaceId: b.graph_workspace_id, catalogDigest: b.catalog_digest,
      workerGroups, nodeIds: b.allowed_node_ids, enrolledNodes,
      agents: labels(b.allowed_agent_profiles), intelligence: labels(b.allowed_intelligence_profiles), execution: labels(b.allowed_execution_profiles), environments: labels(b.allowed_environments),
      validation: { repository: v.repository, graph: v.graph, recordedAt: timestamp(row.validated_at_ms), observedAt, expiresAt } };
  });
  ensure(raw.next_cursor === null || (items.length === PROJECT_PAGE_SIZE && raw.next_cursor === previous));
  return { items, next: raw.next_cursor as string | null };
}

/** Keyset pages can change between reads; never merge duplicate/backward IDs. */
export function mergeProjectPages(pages: { items: ProjectBindingView[] }[]): ProjectBindingView[] {
  ensure(pages.length <= 4);
  let previous: string | undefined;
  const rows: ProjectBindingView[] = [];
  for (const page of pages) for (const row of page.items) {
    ensure(!previous || row.id > previous);
    rows.push(row); previous = row.id;
  }
  return rows;
}
