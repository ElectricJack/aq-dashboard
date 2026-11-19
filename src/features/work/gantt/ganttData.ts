import { useQueries } from "@tanstack/react-query";
import { adaptGraphNeighborhood, adaptGraphPage, GRAPH_MAX_PAGES, GRAPH_PAGE_SIZE, mergeGraphPages, type GraphEdge, type GraphNode, type GraphPage, type GraphEnvelope } from "../../../api/adapters/humanGraph";
import { apiGet, isProtectedReadFailure } from "../../../api/client";
import { graphPath } from "../../../api/humanGraphReads";
import { queryKey } from "../../../api/queryKeys";
import { PANEL_READ, useSession } from "../../../app/session";
import { listStatus, type TaskStatus } from "../labels";

export type GanttTask = { id: string; title: string; status: TaskStatus; storyPoints: number | null };
export type GanttDependency = { id: string; source: string; target: string };
export type GanttProject = { id: string; label: string };
export type GanttSnapshot = { project: GanttProject; tasks: GanttTask[]; dependencies: GanttDependency[]; partial: boolean };

export const GANTT_POLL_MS = 20_000;
export const GANTT_PROJECT_LIMIT = 4;
const TASK_LIMIT = GRAPH_PAGE_SIZE * GRAPH_MAX_PAGES;

const inTrack = (node: GraphNode) => !node.deleted && !node.retired && node.task_state !== "completed";
const taskOrder: Partial<Record<TaskStatus, number>> = { running: 0, held: 1, active: 2, waiting: 3, draft: 4, canceled: 6 };
export const ganttTaskPriority = (status: TaskStatus) => taskOrder[status] ?? 5;

async function readGantt(project: string, signal: AbortSignal): Promise<GanttSnapshot> {
  const path = graphPath(project, "task");
  const pages: GraphEnvelope<GraphPage>[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: String(GRAPH_PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    const page = adaptGraphPage(await apiGet<unknown>(`${path}?${params}`, signal), project, "task");
    pages.push(page);
    cursor = page.data.next_cursor;
  } while (cursor && pages.length < GRAPH_MAX_PAGES);

  const binding = pages[0]!.project;
  const rows = mergeGraphPages(pages);
  const attempts = new Map(pages.flatMap(page => page.data.executions.map(e => [e.task_id, e.status] as const)));
  const status = (node: GraphNode) => listStatus(node, attempts.get(node.id));
  const known = new Map(rows.map(node => [node.id, node]));
  const edges = new Map<string, GraphEdge>();
  let partial = !!cursor;
  // Visit running work first. Follow omitted list neighbors within the same bounded scan.
  const queue = rows.filter(inTrack).sort((a, b) => ganttTaskPriority(status(a)) - ganttTaskPriority(status(b)));
  const queued = new Set(queue.map(node => node.id));
  for (let index = 0; index < queue.length && index < TASK_LIMIT; index++) {
    const seed = queue[index]!;
    if (!inTrack(known.get(seed.id)!)) continue;
    signal.throwIfAborted();
    try {
      const snapshot = adaptGraphNeighborhood(await apiGet<unknown>(`${path}/${seed.id}/graph`, signal), project, seed.id);
      if (snapshot.project.workspace_id !== binding.workspace_id || snapshot.project.revision !== binding.revision) {
        partial = true;
        continue;
      }
      partial ||= snapshot.data.truncated;
      const neighbors = new Set<string>();
      for (const edge of snapshot.data.edges) {
        if (edge.edge_type !== "blocks") continue;
        edges.set(edge.id, edge);
        neighbors.add(edge.source);
        neighbors.add(edge.target);
      }
      for (const node of snapshot.data.nodes) {
        const previous = known.get(node.id);
        if (!previous || BigInt(node.version) > BigInt(previous.version)) known.set(node.id, node);
        if (!queued.has(node.id) && neighbors.has(node.id) && inTrack(known.get(node.id)!)) {
          queued.add(node.id);
          queue.push(node);
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (isProtectedReadFailure(error)) throw error;
      partial = true;
    }
  }
  partial ||= queue.length > TASK_LIMIT;
  const dependencies = [...edges.values()].filter(({ source, target }) => inTrack(known.get(source)!) && inTrack(known.get(target)!));
  const prerequisites = new Set(dependencies.map(edge => edge.target));
  const tasks = [...queued].flatMap(id => {
    const node = known.get(id)!;
    if (!inTrack(node)) return [];
    const lifecycle = status(node);
    // A waiting label describes a recorded prerequisite. AQ's inspector owns scheduling readiness.
    const display = lifecycle === "active" && prerequisites.has(id) ? "waiting" : lifecycle;
    // A canceled prerequisite may still prevent progress. Keep it visible only while it has dependents.
    if (display === "canceled" && !dependencies.some(edge => edge.source === id)) return [];
    return [{ id, title: node.title, status: display, storyPoints: node.story_points ?? null }];
  });
  const visible = new Set(tasks.map(task => task.id));
  return {
    project: { id: project, label: binding.name },
    tasks,
    dependencies: dependencies.filter(({ source, target }) => visible.has(source) && visible.has(target)),
    partial,
  };
}

export function useGanttProjects(projects: GanttProject[]) {
  const { queryContext } = useSession();
  return useQueries({
    queries: projects.map(({ id }) => ({
      queryKey: queryKey(queryContext, "human-graph-gantt", { project: id }),
      queryFn: ({ signal }: { signal: AbortSignal }) => readGantt(id, signal),
      staleTime: GANTT_POLL_MS,
      refetchInterval: GANTT_POLL_MS,
      meta: PANEL_READ,
      retry: false,
    })),
  });
}
