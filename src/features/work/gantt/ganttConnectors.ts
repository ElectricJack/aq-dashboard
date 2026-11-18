import type { GanttLayout, PositionedTask } from "./ganttLayout";

export const STEP_WIDTH = 150;
export const BAR_WIDTH = 106;
export const RULER_HEIGHT = 32;
export const barStart = (task: PositionedTask) => task.column * STEP_WIDTH + 14;

type Edge = GanttLayout["edges"][number];
type Fork = { source: PositionedTask; edges: Edge[]; top: number; bottom: number };

/** Branches leaving the same bar share a vertical trunk within each destination step's gap.
 * Sources with overlapping vertical spans use separate trunks, including when they share an endpoint. */
export function dependencyPaths(edges: Edge[], rowHeight: number, zoom: number) {
  const byStep = new Map<number, Map<string, Fork>>();
  const paths = new Map<string, string>();
  const y = (task: PositionedTask) => (task.row + 0.5) * rowHeight;
  const pos = (x: number) => x * zoom;
  for (const edge of edges) {
    const { source, target } = edge;
    if (target.column <= source.column) {
      // A cycle has no forward dependency order. Route the return around its bars.
      const start = barStart(source) + BAR_WIDTH;
      const end = barStart(target) - 3 / zoom;
      const detour = (source.row + 1) * rowHeight - 2;
      paths.set(edge.id, `M ${pos(start)} ${y(source)} H ${pos(start + 12)} V ${detour} H ${pos(end - 5)} V ${y(target)} H ${pos(end)}`);
      continue;
    }
    let forks = byStep.get(target.column);
    if (!forks) byStep.set(target.column, forks = new Map());
    const fork = forks.get(source.key);
    if (fork) {
      fork.edges.push(edge);
      fork.top = Math.min(fork.top, target.row);
      fork.bottom = Math.max(fork.bottom, target.row);
    } else {
      forks.set(source.key, { source, edges: [edge], top: Math.min(source.row, target.row), bottom: Math.max(source.row, target.row) });
    }
  }

  for (const forks of byStep.values()) {
    const lanes: number[] = [];
    const ordered = [...forks.values()].sort((a, b) => a.top - b.top);
    const placements = ordered.map(fork => {
      const free = lanes.findIndex(end => end < fork.top);
      const lane = free < 0 ? lanes.length : free;
      lanes[lane] = fork.bottom;
      return { fork, lane };
    });
    for (const { fork, lane } of placements) {
      const gap = (STEP_WIDTH - BAR_WIDTH) * zoom;
      const end = pos(barStart(fork.edges[0]!.target)) - 3;
      const bend = end - 3 - (gap - 10) * (lane + 1) / (lanes.length + 1);
      const start = pos(barStart(fork.source) + BAR_WIDTH);
      for (const { id, target } of fork.edges) {
        paths.set(id, `M ${start} ${y(fork.source)} H ${bend} V ${y(target)} H ${end}`);
      }
    }
  }
  return paths;
}
