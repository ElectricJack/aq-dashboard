import type { TaskGraphView } from "../../../api/adapters/inspection";
import { layoutGraph, MAX_NODES } from "./layout";

function node(id: string, title = id): TaskGraphView["nodes"][number] {
  return { id, revision: "1", title, state: "active", readiness: { state: "ready", explanation: "" } };
}
function graph(ids: string[], edges: [string, string, TaskGraphView["edges"][number]["category"]][]): TaskGraphView {
  return {
    rootId: ids[0]!,
    nodes: ids.map((i) => node(i)),
    edges: edges.map(([from, to, category]) => ({ from, to, type: "blocks", category })),
    omitted: { nodes: 0, edges: 0, reason: null },
  };
}

test("prerequisites are placed in earlier layers than dependents", () => {
  const l = layoutGraph(graph(["a", "b", "c"], [["a", "b", "dependency"], ["b", "c", "dependency"]]));
  const layer = (id: string) => l.nodes.find((n) => n.id === id)!.layer;
  expect([layer("a"), layer("b"), layer("c")]).toEqual([0, 1, 2]);
});

test("informational edges do not change layers", () => {
  const l = layoutGraph(graph(["a", "b"], [["a", "b", "informational"]]));
  expect(l.nodes.map((n) => n.layer)).toEqual([0, 0]);
});

test("layout is deterministic regardless of input order", () => {
  const g1 = graph(["a", "b", "c", "d"], [["a", "c", "dependency"], ["b", "c", "dependency"], ["c", "d", "hierarchy"]]);
  const g2 = { ...g1, nodes: [...g1.nodes].reverse(), edges: [...g1.edges].reverse() };
  const pos = (g: TaskGraphView) =>
    Object.fromEntries(layoutGraph(g).nodes.map((n) => [n.id, [n.x, n.y]]));
  expect(pos(g2)).toEqual(pos(g1));
});

test("a cycle terminates and still places every node", () => {
  const l = layoutGraph(graph(["a", "b"], [["a", "b", "dependency"], ["b", "a", "dependency"]]));
  expect(l.nodes).toHaveLength(2);
  expect(l.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
});

test("more than the node cap is truncated and counted as omitted", () => {
  const ids = Array.from({ length: MAX_NODES + 5 }, (_, i) => `n${String(i).padStart(3, "0")}`);
  const l = layoutGraph(graph(ids, []));
  expect(l.nodes).toHaveLength(MAX_NODES);
  expect(l.clientOmitted).toBe(5);
});

test("edges are routed only between placed nodes", () => {
  const l = layoutGraph(graph(["a", "b"], [["a", "b", "dependency"]]));
  expect(l.edges).toHaveLength(1);
  expect(l.edges[0]!.path).toMatch(/^M/);
  expect(l.width).toBeGreaterThan(0);
  expect(l.height).toBeGreaterThan(0);
});
