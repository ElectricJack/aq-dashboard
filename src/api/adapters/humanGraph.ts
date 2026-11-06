import { ContractError, isRecord } from "./contract";

export const HUMAN_GRAPH_CONTRACT = "human-graph-1";
export const GRAPH_PAGE_SIZE = 25;
export const GRAPH_MAX_PAGES = 4;
export type GraphNode = {
  id: string; kind: "task" | "knowledge"; title: string; body: string; acceptance_criteria: string;
  labels: string[]; task_state: string | null; verification: string | null; content_type: string | null;
  retired: boolean; deleted: boolean; created_at: string; updated_at: string; version: string; content_revision: string;
  created_by: string; provenance: unknown[]; last_verified_by: string | null; last_verified_at: string | null;
  retirement_reason: string | null; valid_from: string | null; valid_until: string | null; review_at: string | null;
  successor_id: string | null; summary: string | null; summary_of_revision: string | null;
};
export type GraphEdge = { id: string; source: string; target: string; edge_type: string; description: string | null;
  version: string; source_revision: string | null; target_revision: string | null };
export type GraphEnvelope<T> = { contract: typeof HUMAN_GRAPH_CONTRACT; project: { id: string; name: string; revision: string; workspace_id: string }; observed_at: string; data: T };
/** An attempt holding a task, from a list page's `executions` (only tasks that have one) or the work read. */
export type GraphExecution = { task_id: string; attempt_id: string; session_id: string; status: string };
export type GraphPage = { items: GraphNode[]; next_cursor: string | null; executions: GraphExecution[] };
/** The task's parent from a live `parent-child` edge; `kind`, `title` and `task_state` are null when the parent isn't in the read Context. */
export type GraphParent = { id: string; kind: GraphNode["kind"] | null; title: string | null; task_state: string | null; edge_id: string };
export type GraphStateCounts = { draft: string; active: string; completed: string; canceled: string; unknown: string };
/** What the bounded neighborhood dropped (X10). `exact` false: the counts are lower bounds. */
export type GraphOmitted = { tasks: string; tasks_by_state: GraphStateCounts; other_nodes: string; edges: string; exact: boolean };
/** `parent`, `omitted` and `expansion` are null from a server that predates them (X9, X10). */
export type GraphNeighborhood = { root_id: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean;
  parent: GraphParent | null; omitted: GraphOmitted | null; expansion: { limit: string } | null };
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validGraphId(value: unknown): value is string { return typeof value === "string" && UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000"; }
function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid human Graph response"); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
/** Graph titles are bounded by Unicode scalars, matching the Rust API. */
function title(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024 || !value.trim()) return false;
  let scalars = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (scalar === 0 || (scalar >= 0xd800 && scalar <= 0xdfff) || ++scalars > 512) return false;
  }
  return true;
}
function revision(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value); }
function time(value: unknown): value is string { return text(value, 40) && Number.isFinite(Date.parse(value)); }
function optional(value: unknown, test: (v: unknown) => boolean) { return value === null || test(value); }
const COUNT = /^(0|[1-9][0-9]{0,18})$/;
export function graphCount(value: unknown): value is string { return typeof value === "string" && COUNT.test(value); }
const TASK_STATES = ["draft", "active", "completed", "canceled"];
export function adaptStateCounts(value: unknown): GraphStateCounts {
  check(isRecord(value) && ["draft","active","completed","canceled","unknown"].every(k => graphCount(value[k])));
  return { draft: value.draft as string, active: value.active as string, completed: value.completed as string, canceled: value.canceled as string, unknown: value.unknown as string };
}
/** `parent` on graph and work data (X9). Absent (older server) and null both read as "no parent known". */
export function adaptGraphParent(value: unknown): GraphParent | null {
  if (value === undefined || value === null) return null;
  check(isRecord(value) && validGraphId(value.id) && validGraphId(value.edge_id));
  check(value.kind === null || value.kind === "task" || value.kind === "knowledge");
  check(value.title === null || (typeof value.title === "string" && value.title.length <= 1024));
  check(value.task_state === null || TASK_STATES.includes(value.task_state as string));
  return { id: value.id, kind: value.kind as GraphParent["kind"], title: value.title as string | null, task_state: value.task_state as string | null, edge_id: value.edge_id };
}
export function adaptGraphExecution(value: unknown): GraphExecution {
  check(isRecord(value) && validGraphId(value.task_id) && validGraphId(value.attempt_id) && validGraphId(value.session_id) && typeof value.status === "string" && value.status.length > 0 && value.status.length <= 64);
  return { task_id: value.task_id, attempt_id: value.attempt_id, session_id: value.session_id, status: value.status };
}
function adaptOmitted(value: unknown): GraphOmitted | null {
  if (value === undefined) return null;
  check(isRecord(value) && graphCount(value.tasks) && graphCount(value.other_nodes) && graphCount(value.edges) && typeof value.exact === "boolean");
  return { tasks: value.tasks, tasks_by_state: adaptStateCounts(value.tasks_by_state), other_nodes: value.other_nodes, edges: value.edges, exact: value.exact };
}
function adaptExpansion(value: unknown): { limit: string } | null {
  if (value === undefined || value === null) return null;
  check(isRecord(value) && typeof value.limit === "string" && /^[1-9][0-9]{0,18}$/.test(value.limit));
  return { limit: value.limit };
}
export function adaptGraphNode(value: unknown, kind: GraphNode["kind"]): GraphNode {
  check(isRecord(value));
  check(validGraphId(value.id) && value.kind === kind && title(value.title));
  check(text(value.body, 262144) && text(value.acceptance_criteria, 16384));
  check(Array.isArray(value.labels) && value.labels.length <= 64 && value.labels.every(v => text(v,128)));
  check(optional(value.task_state, v => text(v,64)) && optional(value.verification,v => text(v,64)) && optional(value.content_type,v => text(v,128)));
  check(typeof value.retired === "boolean" && typeof value.deleted === "boolean" && time(value.created_at) && time(value.updated_at));
  check(revision(value.version) && revision(value.content_revision));
  // Provenance descriptors remain literal data until a typed, safe source-link adapter exists.
  check(text(value.created_by,512) && Array.isArray(value.provenance) && value.provenance.length <= 64);
  for (const key of ["last_verified_by","retirement_reason","summary"]) check(optional(value[key],v => text(v,key === "summary" ? 8192 : 4096)));
  for (const key of ["last_verified_at","valid_from","valid_until","review_at"]) check(optional(value[key],time));
  check(optional(value.successor_id,validGraphId) && optional(value.summary_of_revision,revision));
  return value as unknown as GraphNode;
}
export function adaptGraphEnvelope<T>(raw: unknown, project: string, adapt: (v: unknown) => T): GraphEnvelope<T> {
  check(validGraphId(project) && isRecord(raw) && raw.contract === HUMAN_GRAPH_CONTRACT && isRecord(raw.project));
  check(raw.project.id === project && validGraphId(raw.project.workspace_id) && revision(raw.project.revision) && text(raw.project.name,128) && time(raw.observed_at));
  return { contract:HUMAN_GRAPH_CONTRACT, project:raw.project as GraphEnvelope<T>["project"],observed_at:raw.observed_at,data:adapt(raw.data) };
}
export function adaptGraphPage(raw: unknown, project: string, kind: GraphNode["kind"]) {
  return adaptGraphEnvelope(raw,project,value => {
    check(isRecord(value) && Array.isArray(value.items) && value.items.length <= GRAPH_PAGE_SIZE);
    check(value.next_cursor === null || (text(value.next_cursor,4096) && value.next_cursor.length > 0));
    const items=value.items.map(v => adaptGraphNode(v,kind));
    check(new Set(items.map(n => n.id)).size === items.length);
    // Task pages carry `executions` (X12) for the listed tasks an attempt holds; older servers omit it.
    check(value.executions === undefined || (Array.isArray(value.executions) && value.executions.length <= 64));
    const executions=((value.executions as unknown[] | undefined) ?? []).map(adaptGraphExecution);
    check(new Set(executions.map(e => e.task_id)).size === executions.length);
    return {items,next_cursor:value.next_cursor as string|null,executions};
  });
}
export function adaptGraphDetail(raw: unknown, project: string, kind: GraphNode["kind"], id: string, pinned?: string) {
  return adaptGraphEnvelope(raw,project,value => {
    const node=adaptGraphNode(value,kind);check(node.id === id && (!pinned || node.content_revision === pinned));return node;
  });
}
export function adaptGraphNeighborhood(raw: unknown, project: string, root: string) {
  return adaptGraphEnvelope(raw,project,value => {
    check(isRecord(value) && value.root_id === root && Array.isArray(value.nodes) && value.nodes.length <=64 && Array.isArray(value.edges) && value.edges.length <=256 && typeof value.truncated === "boolean");
    const nodes=value.nodes.map(v=>adaptGraphNode(v,"task")), ids=new Set(nodes.map(n=>n.id));
    check(ids.size===nodes.length && ids.has(root));
    const edges=value.edges.map(v=>{
      check(isRecord(v) && validGraphId(v.id) && typeof v.source === "string" && ids.has(v.source) && typeof v.target === "string" && ids.has(v.target));
      check(text(v.edge_type,128) && optional(v.description,v=>text(v,4096)) && revision(v.version) && optional(v.source_revision,revision) && optional(v.target_revision,revision));
      return v as unknown as GraphEdge;
    });
    check(new Set(edges.map(e=>e.id)).size===edges.length);
    return {root_id:root,nodes,edges,truncated:value.truncated,parent:adaptGraphParent(value.parent),omitted:adaptOmitted(value.omitted),expansion:adaptExpansion(value.expansion)};
  });
}
/** Check pages at display time too: drift must never merge old and new bindings. */
/** Tasks an attempt holds, across the loaded pages (list status "running", spec 0004 item 16). */
export function heldTasks(pages: GraphEnvelope<GraphPage>[]): Set<string> {
  return new Set(pages.flatMap(page => page.data.executions.map(e => e.task_id)));
}
export function mergeGraphPages(pages: GraphEnvelope<GraphPage>[]) {
  check(pages.length<=GRAPH_MAX_PAGES);
  const binding=pages[0]?.project, ids=new Set<string>();
  return pages.flatMap(page=>{
    check(page.project.id===binding?.id && page.project.revision===binding.revision && page.project.workspace_id===binding.workspace_id);
    return page.data.items.map(n=>{check(!ids.has(n.id));ids.add(n.id);return n;});
  });
}

export const nodeLabel = (value:string|null) => value ? ({active:"Active",draft:"Draft",completed:"Completed",canceled:"Canceled",verified:"Verified",unverified:"Unverified",disputed:"Disputed"}[value] ?? value) : "Unknown";
