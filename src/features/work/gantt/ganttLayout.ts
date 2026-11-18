import { ganttTaskPriority, type GanttSnapshot, type GanttTask } from "./ganttData";

export type PositionedTask = GanttTask & { kind: "task"; key: string; project: string; row: number; start: number; span: number };
type PositionedEdge = { id: string; source: PositionedTask; target: PositionedTask };
type ProjectRow = { kind: "project"; id: string; title: string; row: number };

export function layoutGantt(projects: GanttSnapshot[], grouped: boolean, search: string) {
  const tasks: PositionedTask[] = [];
  const edges: PositionedEdge[] = [];
  const groups: ProjectRow[] = [];
  let rowCount = 0;
  let totalPoints = 1;
  let unresolved = false;

  // Keep unestimated tasks and their dependencies visible with a distinct,
  // explicitly labelled one-point placeholder.
  const span = (task: GanttTask) => task.storyPoints ?? 1;
  for (const project of projects) {
    const order = (a: GanttTask, b: GanttTask) => ganttTaskPriority(a.status) - ganttTaskPriority(b.status) || a.id.localeCompare(b.id);
    const byId = new Map(project.tasks.map(task => [task.id, task]));
    const incoming = new Map(project.tasks.map(task => [task.id, new Set<string>()]));
    const outgoing = new Map(project.tasks.map(task => [task.id, new Set<string>()]));
    for (const edge of project.dependencies) {
      incoming.get(edge.target)!.add(edge.source);
      outgoing.get(edge.source)!.add(edge.target);
    }
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
    const matches = new Set(project.tasks.filter(task => task.title.toLowerCase().includes(search)).map(task => task.id));
    if (!matches.size) continue;
    // Search retains the connected tracks so a match never loses the context of its prerequisites.
    const included = [...matches];
    for (const id of included) {
      for (const neighbor of [...incoming.get(id)!, ...outgoing.get(id)!]) {
        if (matches.has(neighbor)) continue;
        matches.add(neighbor);
        included.push(neighbor);
      }
    }
    if (grouped) groups.push({ kind: "project", id: project.project.id, title: project.project.label, row: rowCount++ });

    const positioned = new Map<string, PositionedTask>();
    function place(id: string) {
      const item = byId.get(id)!;
      const start = starts.get(id) ?? 0;
      const length = span(item);
      totalPoints = Math.max(totalPoints, start + length);
      const task: PositionedTask = { ...item, kind: "task", key: `${project.project.id}/${id}`, project: project.project.id, row: rowCount++, start, span: length };
      positioned.set(id, task);
      tasks.push(task);
    }
    // Order each track by starting point so fork siblings stay together and joins sit
    // below all of their prerequisites, including prerequisites on earlier tracks.
    const visited = new Set(queue);
    queue.sort((a, b) => tracks.get(a)! - tracks.get(b)! || starts.get(a)! - starts.get(b)! || order(byId.get(a)!, byId.get(b)!));
    for (const id of queue) if (matches.has(id)) place(id);
    // Unsorted nodes indicate cyclic dependencies or work downstream of them.
    // Display their observed links and avoid assigning a dependency order through the cycle.
    for (const id of included) {
      if (visited.has(id)) continue;
      unresolved = true;
      place(id);
    }
    for (const edge of project.dependencies) {
      const source = positioned.get(edge.source), target = positioned.get(edge.target);
      if (source && target) edges.push({ id: `${project.project.id}/${edge.id}`, source, target });
    }
  }

  return { tasks, edges, groups, rowCount, totalPoints, unresolved };
}

export type GanttLayout = ReturnType<typeof layoutGantt>;
