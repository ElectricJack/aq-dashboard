import type { EdgeCategory, TaskGraphView } from "../../../api/adapters/inspection";

/** Client render cap; the server should already bound the neighbourhood (docs/specs/0002 §4). */
export const MAX_NODES = 100;

export const NODE_W = 220;
export const NODE_H = 72;
const COL_GAP = 72;
const ROW_GAP = 28;
const PAD = 16;

export type PlacedNode = TaskGraphView["nodes"][number] & { layer: number; x: number; y: number };
export type PlacedEdge = { from: string; to: string; type: string; category: EdgeCategory; path: string };
export type GraphLayout = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  /** Nodes dropped by the client cap, in addition to server-omitted ones. */
  clientOmitted: number;
};

const byTitle = (a: { title: string; id: string }, b: { title: string; id: string }) =>
  a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Deterministic layered layout: a node's layer is the longest structural
 * (dependency or hierarchy) path reaching it. Informational edges never
 * move nodes. Same input set always gives the same positions.
 */
export function layoutGraph(graph: TaskGraphView): GraphLayout {
  const sorted = [...graph.nodes].sort(byTitle);
  const kept = sorted.slice(0, MAX_NODES);
  const ids = new Set(kept.map((n) => n.id));
  const structural = graph.edges.filter((e) => e.category !== "informational" && ids.has(e.from) && ids.has(e.to));

  const layer = new Map(kept.map((n) => [n.id, 0]));
  // Bellman-Ford style relaxation; bounded so a cycle cannot loop forever.
  for (let pass = 0; pass < kept.length; pass++) {
    let changed = false;
    for (const e of structural) {
      const next = layer.get(e.from)! + 1;
      if (next > layer.get(e.to)! && next < kept.length) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, typeof kept>();
  for (const n of kept) {
    const l = layer.get(n.id)!;
    columns.set(l, [...(columns.get(l) ?? []), n]);
  }
  const nodes: PlacedNode[] = [];
  let rows = 0;
  for (const [l, col] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    col.sort(byTitle).forEach((n, i) => {
      nodes.push({ ...n, layer: l, x: PAD + l * (NODE_W + COL_GAP), y: PAD + i * (NODE_H + ROW_GAP) });
    });
    rows = Math.max(rows, col.length);
  }
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const forward = b.x > a.x;
      const x1 = forward ? a.x + NODE_W : a.x + NODE_W / 2;
      const y1 = forward ? a.y + NODE_H / 2 : a.y + NODE_H;
      const x2 = forward ? b.x : b.x + NODE_W / 2;
      const y2 = forward ? b.y + NODE_H / 2 : b.y;
      const path = forward
        ? `M${x1},${y1} C${x1 + COL_GAP / 2},${y1} ${x2 - COL_GAP / 2},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1},${y1 + ROW_GAP} ${x2},${y2 - ROW_GAP} ${x2},${y2}`;
      return { from: e.from, to: e.to, type: e.type, category: e.category, path };
    });
  const layers = columns.size || 1;
  return {
    nodes,
    edges,
    width: PAD * 2 + layers * NODE_W + (layers - 1) * COL_GAP,
    height: PAD * 2 + Math.max(rows, 1) * NODE_H + Math.max(rows - 1, 0) * ROW_GAP,
    clientOmitted: sorted.length - kept.length,
  };
}
