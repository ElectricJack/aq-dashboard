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
export type GraphEdge = { id: string; source: string; target: string; edge_type: string; description: string;
  version: string; source_revision: string | null; target_revision: string | null };
export type GraphEnvelope<T> = { contract: typeof HUMAN_GRAPH_CONTRACT; project: { id: string; name: string; revision: string; workspace_id: string }; observed_at: string; data: T };
export type GraphPage = { items: GraphNode[]; next_cursor: string | null };
export type GraphNeighborhood = { root_id: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validGraphId(value: unknown): value is string { return typeof value === "string" && UUID.test(value) && value !== "00000000-0000-0000-0000-000000000000"; }
function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid human Graph response"); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
function revision(value: unknown): value is string { return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value); }
function time(value: unknown): value is string { return text(value, 40) && Number.isFinite(Date.parse(value)); }
function optional(value: unknown, test: (v: unknown) => boolean) { return value === null || test(value); }
export function adaptGraphNode(value: unknown, kind: GraphNode["kind"]): GraphNode {
  check(isRecord(value));
  check(validGraphId(value.id) && value.kind === kind && text(value.title, 512) && value.title.trim());
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
    return {items,next_cursor:value.next_cursor as string|null};
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
      check(text(v.edge_type,128) && text(v.description,4096) && revision(v.version) && optional(v.source_revision,revision) && optional(v.target_revision,revision));
      return v as unknown as GraphEdge;
    });
    check(new Set(edges.map(e=>e.id)).size===edges.length);
    return {root_id:root,nodes,edges,truncated:value.truncated};
  });
}
/** Check pages at display time too: drift must never merge old and new bindings. */
export function mergeGraphPages(pages: GraphEnvelope<GraphPage>[]) {
  check(pages.length<=GRAPH_MAX_PAGES);
  const binding=pages[0]?.project, ids=new Set<string>();
  return pages.flatMap(page=>{
    check(page.project.id===binding?.id && page.project.revision===binding.revision && page.project.workspace_id===binding.workspace_id);
    return page.data.items.map(n=>{check(!ids.has(n.id));ids.add(n.id);return n;});
  });
}

export const nodeLabel = (value:string|null) => value ? ({active:"Active",draft:"Draft",completed:"Completed",canceled:"Canceled",verified:"Verified",unverified:"Unverified",disputed:"Disputed"}[value] ?? value) : "Unknown";
