import { canonicalUuid, positiveInteger, timestampMs, boundedList, ContractError, isRecord } from "./contract";
export const PROJECT_PAGE_SIZE = 25;
export type ProjectBindingView = {
  id: string; name: string; revision: number; enabled: boolean;
  binding: Record<string,unknown>; workerPolicy: "enabled" | "disabled" | "missing" | "unknown";
  repositoryId: string; repositoryGeneration: number; workspaceId: string;
  /** The role of a task that names none, and the level of a task the router did not assign one. */
  defaultRole: string; defaultIntelligence: string;
  /** The Markdown this project adds for a role, after the role's own prompt; by role id. */
  roleNotes: { role: string; note: string }[];
  environments: string[]; workerGroups: string[]; nodeIds: string[]; enrolledNodes: boolean;
  validation: { repository: string; graph: string; recordedAt: string; observedAt: string; expiresAt: string };
};
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid project binding page"); }
function label(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f]/.test(v); }
function labels(value: unknown, empty = false): string[] {
  ensure(boundedList(value, 32, label));
  ensure(empty || value.length > 0);
  ensure(new Set(value).size === value.length);
  return value as string[];
}
/**
 * A binding's defaults (aq-server spec 0014 §5.4, `aq-project-policy`). The server does not write a default that has its
 * usual value, so an absent `default_role` is `developer` and an absent `default_intelligence` is `standard-high`.
 */
export const BINDING_DEFAULT_ROLE = "developer", BINDING_DEFAULT_INTELLIGENCE = "standard-high";
function labelOr(v: unknown, fallback: string): string { ensure(v === undefined || label(v)); return (v as string | undefined) ?? fallback; }
function roleNotes(v: unknown): { role: string; note: string }[] {
  if (v === undefined) return [];
  ensure(isRecord(v) && Object.keys(v).length <= 128 && Object.entries(v).every(([role, note]) => label(role) && typeof note === "string" && !note.includes("\0")));
  return Object.entries(v).filter(([, note]) => (note as string).trim() !== "").map(([role, note]) => ({ role, note: note as string })).sort((a, b) => a.role < b.role ? -1 : a.role > b.role ? 1 : 0);
}
function timestamp(v: unknown): string { ensure(timestampMs(v)); return new Date(v).toISOString(); }
export function validationLabel(v: string): string {
  return ({ verified: "Verified", absent: "Absent", stale: "Stale", forbidden: "Forbidden", unavailable: "Unavailable", unsupported: "Unsupported" } as Record<string, string>)[v] ?? "Unknown";
}
function workerPolicy(execution: unknown, project: string): ProjectBindingView["workerPolicy"] {
  if (execution === undefined) return "unknown";
  ensure(isRecord(execution));
  const value = execution[project];
  if (value === undefined) return "missing";
  ensure(typeof value === "boolean");
  return value ? "enabled" : "disabled";
}

function bindingValidation(b: Record<string, unknown>, v: Record<string, unknown>, recorded: unknown): ProjectBindingView["validation"] {
  ensure(v.repository_generation === b.repository_binding_generation);
  for (const key of ["repository_id", "graph_workspace_id", "repository_adapter_reference", "graph_adapter_reference"]) ensure(v[key] === b[key]);
  ensure(label(v.repository) && label(v.graph));
  const observedAt = timestamp(v.observed_at_ms), expiresAt = timestamp(v.expires_at_ms);
  ensure((v.expires_at_ms as number) > (v.observed_at_ms as number));
  return { repository: v.repository, graph: v.graph, recordedAt: timestamp(recorded), observedAt, expiresAt };
}

function bindingWorkers(b: Record<string, unknown>) {
  const nodeIds = b.allowed_node_ids;
  ensure(boundedList(nodeIds, 256, canonicalUuid));
  ensure(new Set(nodeIds).size === nodeIds.length);
  const workerGroups = labels(b.allowed_worker_groups, true);
  // The server omits the field when it is true (default on).
  const enrolledNodes = b.allow_enrolled_nodes !== false;
  ensure(workerGroups.length > 0 || nodeIds.length > 0 || enrolledNodes);
  return { workerGroups, nodeIds: nodeIds as string[], enrolledNodes };
}

function bindingRow(row: unknown, execution: unknown): ProjectBindingView {
  ensure(isRecord(row));
  ensure(positiveInteger(row.revision));
  ensure(isRecord(row.binding));
  ensure(isRecord(row.validation));
  const b = row.binding;
  ensure(b.schema_version === 1 && canonicalUuid(b.project_id));
  ensure(label(b.name) && typeof b.enabled === "boolean");
  ensure(canonicalUuid(b.repository_id));
  ensure(canonicalUuid(b.graph_workspace_id));
  ensure(positiveInteger(b.repository_binding_generation));
  return {
    binding: b, workerPolicy: workerPolicy(execution, b.project_id), id: b.project_id, name: b.name, revision: row.revision,
    enabled: b.enabled, repositoryId: b.repository_id, repositoryGeneration: b.repository_binding_generation, workspaceId: b.graph_workspace_id,
    ...bindingWorkers(b),
    defaultRole: labelOr(b.default_role, BINDING_DEFAULT_ROLE), defaultIntelligence: labelOr(b.default_intelligence, BINDING_DEFAULT_INTELLIGENCE),
    roleNotes: roleNotes(b.role_notes), environments: labels(b.allowed_environments), validation: bindingValidation(b, row.validation, row.validated_at_ms),
  };
}

export function adaptProjectBindings(raw: unknown, after: string | null) {
  ensure(isRecord(raw) && Array.isArray(raw.items) && raw.items.length <= PROJECT_PAGE_SIZE);
  ensure(raw.next_cursor === null || canonicalUuid(raw.next_cursor));
  let previous = after;
  const items = raw.items.map((value: unknown) => {
    const row = bindingRow(value, raw.execution);
    ensure(!previous || row.id > previous);
    previous = row.id;
    return row;
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
