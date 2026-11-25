import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { GRAPH_MAX_PAGES, GRAPH_PAGE_SIZE, mergeGraphPages, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { useGraphList } from "../../api/humanGraphReads";
import { GANTT_POLL_MS } from "./gantt/ganttData";
import { workStateFilter } from "./labels";
import { useTaskWork } from "./taskWork";
import { useEscapeFocus } from "./useSelectionFocus";

export type WorkSpaceProps = { project?: string; detailProject?: string; id?: string; action?: ReactNode };

function mergedRows(query: ReturnType<typeof useGraphList>, openOnly: boolean) {
  try { return { rows: mergeGraphPages(query.data?.pages ?? [], openOnly) }; }
  catch (mergeError) { return { rows: [] as GraphNode[], mergeError }; }
}

function filteredRows(rows: GraphNode[], state: ReturnType<typeof workStateFilter>, openOnly: boolean) {
  if (openOnly) return rows.slice(0, GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE);
  if (state === "all" || state === "open") return rows;
  return rows.filter(row => row.task_state === state);
}

function viewFilters(params: URLSearchParams) {
  const q = (params.get("q") ?? "").slice(0, 256);
  const state = workStateFilter(params.get("state"));
  const view = params.get("view");
  const graph = view === "graph", gantt = view === "gantt";
  return { q, state, graph, gantt, openOnly: state === "open" && !graph && !gantt };
}

function taskRoot(root: string | null, selected: string | undefined, visible: GraphNode[]) {
  if (validGraphId(root)) return root;
  return selected ?? visible[0]?.id;
}

function useInspectedTask({ project = "", id = "", gantt }: { project?: string; id?: string; gantt: boolean }) {
  return useTaskWork(project, id, gantt ? GANTT_POLL_MS : undefined).data?.data;
}

export function useTaskWorkspaceModel({ project, detailProject = project, id }: WorkSpaceProps) {
  const [params, setParams] = useSearchParams();
  const { q, state, graph, gantt, openOnly } = viewFilters(params);
  const query = useGraphList(gantt ? "" : project ?? "", "task", q, openOnly);
  const { rows, mergeError } = mergedRows(query, openOnly);
  // The attempt status per held task: an ended attempt that still holds the task reads as held, not running (P1-01).
  const held = new Map((query.data?.pages ?? []).flatMap(page => page.data.executions.map(e => [e.task_id, e.status] as const)));
  // The inspected task's work read (shared with the inspector, no extra request): its row follows AQ's `held`.
  const selectedWork = useInspectedTask({ project: detailProject, id, gantt });
  // Expand (spec 0004 §3): the inspector takes the full width; `?focus=1` keeps it linkable across reloads.
  const focused = !!id && params.get("focus") === "1";
  const filtered = filteredRows(rows, state, openOnly);
  const search = params.toString() ? `?${params}` : "";
  const root = params.get("root");
  // With no selection the graph roots on the first loaded task, never a "pick one first" placeholder.
  const graphRoot = taskRoot(root, id, filtered);
  const unavailable = query.isError || !!mergeError;
  const update = (key: string, value: string) => setParams(p => {
    const n = new URLSearchParams(p);
    if (value) n.set(key, value); else n.delete(key);
    return n;
  });
  useEscapeFocus(focused, update);
  return { q, state, graph, gantt, openOnly, query, rows, mergeError, held, selectedWork, focused, filtered, search, graphRoot, unavailable, update, project, id, detailProject };
}
export type Model = ReturnType<typeof useTaskWorkspaceModel>;
