import { ganttTaskPriority, type GanttSnapshot, type GanttTask } from "./ganttData";

export type PositionedTask = GanttTask & { kind: "task"; key: string; project: string; row: number; start: number; span: number };
type PositionedEdge = { id: string; source: PositionedTask; target: PositionedTask };
type ProjectRow = { kind: "project"; id: string; title: string; row: number };

// Keep unestimated tasks and their dependencies visible with a distinct,
// explicitly labelled one-point placeholder.
const span = (task: GanttTask) => task.storyPoints ?? 1;
const order = (a: GanttTask, b: GanttTask) => ganttTaskPriority(a.status) - ganttTaskPriority(b.status) || a.id.localeCompare(b.id);

function projectGraph(project: GanttSnapshot) {
  const byId = new Map(project.tasks.map(task => [task.id, task]));
  const incoming = new Map(project.tasks.map(task => [task.id, new Set<string>()]));
  const outgoing = new Map(project.tasks.map(task => [task.id, new Set<string>()]));
  for (const edge of project.dependencies) {
    incoming.get(edge.target)!.add(edge.source);
    outgoing.get(edge.source)!.add(edge.target);
  }
  return { incoming, outgoing, byId };
}

type ProjectGraph = ReturnType<typeof projectGraph>;

function schedule(project: GanttSnapshot, graph: ProjectGraph) {
  const { incoming, outgoing, byId } = graph;
  const starts = new Map<string, number>();
  const tracks = new Map<string, number>();
  const remaining = new Map([...incoming].map(([id, sources]) => [id, sources.size]));
  const roots = project.tasks.filter(task => !remaining.get(task.id)).sort(order).map(task => task.id);
  const queue = [...roots];
  roots.forEach((id, index) => {
    starts.set(id, 0);
    tracks.set(id, index);
  });
  for (const id of queue) {
    for (const target of outgoing.get(id)!) {
      starts.set(target, Math.max(starts.get(target) ?? 0, starts.get(id)! + span(byId.get(id)!)));
      tracks.set(target, Math.max(tracks.get(target) ?? 0, tracks.get(id)!));
      const count = remaining.get(target)! - 1;
      remaining.set(target, count);
      if (!count) queue.push(target);
    }
  }
  // Order each track by starting point so fork siblings stay together and joins sit
  // below all of their prerequisites, including prerequisites on earlier tracks.
  const visited = new Set(queue);
  queue.sort((a, b) => tracks.get(a)! - tracks.get(b)! || starts.get(a)! - starts.get(b)! || order(byId.get(a)!, byId.get(b)!));
  return { starts, queue, visited };
}

function connectedMatches(project: GanttSnapshot, graph: ProjectGraph, search: string) {
  const { incoming, outgoing } = graph;
  const matches = new Set(project.tasks.filter(task => task.title.toLowerCase().includes(search)).map(task => task.id));
  // Search retains the connected tracks so a match never loses the context of its prerequisites.
  const included = [...matches];
  for (const id of included) {
    for (const neighbor of [...incoming.get(id)!, ...outgoing.get(id)!]) {
      if (matches.has(neighbor)) continue;
      matches.add(neighbor);
      included.push(neighbor);
    }
  }
  return matches;
}

class Timeline {
  readonly tasks: PositionedTask[] = [];
  readonly edges: PositionedEdge[] = [];
  readonly groups: ProjectRow[] = [];
  rowCount = 0;
  totalPoints = 1;
  unresolved = false;

  append(project: GanttSnapshot, grouped: boolean, search: string) {
    const graph = projectGraph(project);
    const { starts, queue, visited } = schedule(project, graph);
    const matches = connectedMatches(project, graph, search);
    if (!matches.size) return;
    if (grouped) this.groups.push({ kind: "project", id: project.project.id, title: project.project.label, row: this.rowCount++ });

    const positioned = new Map<string, PositionedTask>();
    const place = (id: string) => {
      const item = graph.byId.get(id)!;
      const task = this.placeTask(project.project.id, item, starts.get(id) ?? 0);
      positioned.set(id, task);
    };
    for (const id of queue) if (matches.has(id)) place(id);
    // Cycles and work downstream of them retain their observed links.
    for (const id of matches) {
      if (visited.has(id)) continue;
      this.unresolved = true;
      place(id);
    }
    this.addEdges(project, positioned);
  }

  private placeTask(project: string, item: GanttTask, start: number) {
    const length = span(item);
    this.totalPoints = Math.max(this.totalPoints, start + length);
    const task: PositionedTask = { ...item, kind: "task", key: `${project}/${item.id}`, project, row: this.rowCount++, start, span: length };
    this.tasks.push(task);
    return task;
  }

  private addEdges(project: GanttSnapshot, positioned: Map<string, PositionedTask>) {
    for (const edge of project.dependencies) {
      const source = positioned.get(edge.source), target = positioned.get(edge.target);
      if (source && target) this.edges.push({ id: `${project.project.id}/${edge.id}`, source, target });
    }
  }
}

export function layoutGantt(projects: GanttSnapshot[], grouped: boolean, search: string) {
  const timeline = new Timeline();
  for (const project of projects) timeline.append(project, grouped, search);
  const { tasks, edges, groups, rowCount, totalPoints, unresolved } = timeline;
  return { tasks, edges, groups, rowCount, totalPoints, unresolved };
}

export type GanttLayout = ReturnType<typeof layoutGantt>;
