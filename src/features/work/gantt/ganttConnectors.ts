import type { GanttLayout, PositionedTask } from "./ganttLayout";

export const POINT_WIDTH = 38;
export const AXIS_INSET = 12;
const BAR_INSET = 6;
export const RULER_HEIGHT = 32;
export const plotPoint = (points: number, zoom: number) => AXIS_INSET + points * POINT_WIDTH * zoom;
export const barStart = (task: PositionedTask, zoom: number) => plotPoint(task.start, zoom) + BAR_INSET;
export const barWidth = (task: PositionedTask, zoom: number) => task.span * POINT_WIDTH * zoom - 2 * BAR_INSET;

type Edge = GanttLayout["edges"][number];
type Fork = { source: PositionedTask; edges: Edge[]; top: number; bottom: number };

/** Branches leaving the same bar share a vertical trunk within each destination point's gap.
 * Sources with overlapping vertical spans use separate trunks, including when they share an endpoint. */
export function dependencyPaths(edges: Edge[], rowHeight: number, zoom: number) {
  const byStart = new Map<number, Map<string, Fork>>();
  const paths = new Map<string, string>();
  const y = (task: PositionedTask) => (task.row + 0.5) * rowHeight;

  for (const edge of edges) {
    const { source, target } = edge;
    if (target.start < source.start + source.span) {
      // A cycle has no forward dependency order. Route the return around its bars.
      const start = barStart(source, zoom) + barWidth(source, zoom);
      const end = barStart(target, zoom) - 3;
      const detour = (source.row + 1) * rowHeight - 2;
      paths.set(edge.id, `M ${start} ${y(source)} H ${start + 9} V ${detour} H ${end - 5} V ${y(target)} H ${end}`);
      continue;
    }
    let forks = byStart.get(target.start);
    if (!forks) byStart.set(target.start, forks = new Map());
    const fork = forks.get(source.key);
    if (fork) {
      fork.edges.push(edge);
      fork.top = Math.min(fork.top, target.row);
      fork.bottom = Math.max(fork.bottom, target.row);
    } else {
      forks.set(source.key, { source, edges: [edge], top: Math.min(source.row, target.row), bottom: Math.max(source.row, target.row) });
    }
  }

  for (const forks of byStart.values()) {
    const lanes: number[] = [];
    const ordered = [...forks.values()].sort((a, b) => a.top - b.top);
    const placements = ordered.map(fork => {
      const free = lanes.findIndex(end => end < fork.top);
      const lane = free < 0 ? lanes.length : free;
      lanes[lane] = fork.bottom;
      return { fork, lane };
    });
    for (const { fork, lane } of placements) {
      const end = barStart(fork.edges[0]!.target, zoom) - 2;
      const bend = end - 2 - 6 * (lane + 1) / (lanes.length + 1);
      const start = barStart(fork.source, zoom) + barWidth(fork.source, zoom);
      for (const { id, target } of fork.edges) {
        paths.set(id, `M ${start} ${y(fork.source)} H ${bend} V ${y(target)} H ${end}`);
      }
    }
  }
  return paths;
}
