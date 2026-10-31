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

test("the cap always keeps the root and prefers nodes nearest to it", () => {
  const ids = Array.from({ length: MAX_NODES + 20 }, (_, i) => `n${String(i).padStart(3, "0")}`);
  const g = graph(ids, [["n001", "zroot", "dependency"]]);
  g.nodes.push({ ...g.nodes[0]!, id: "zroot", title: "zzz root" });
  g.rootId = "zroot";
  const l = layoutGraph(g);
  const placed = new Set(l.nodes.map((n) => n.id));
  expect(placed.has("zroot")).toBe(true);
  expect(placed.has("n001")).toBe(true);
});

test("edges cut by the cap are counted", () => {
  const ids = Array.from({ length: MAX_NODES + 1 }, (_, i) => `n${String(i).padStart(3, "0")}`);
  const g = graph(ids, [["n000", `n${MAX_NODES}`, "informational"]]);
  // n099 is unreachable from the root and last by title, so the cap cuts it and its edge.
  g.edges.push({ from: "n098", to: "n099", type: "blocks", category: "dependency" });
  const l = layoutGraph(g);
  expect(l.clientOmitted).toBe(1);
  expect(l.nodes.some((n) => n.id === "n099")).toBe(false);
  expect(l.clientOmittedEdges).toBe(1);
});

test("a cycle among many nodes keeps every node inside the canvas", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `n${String(i).padStart(2, "0")}`);
  const l = layoutGraph(graph(ids, [["n00", "n01", "hierarchy"], ["n01", "n00", "dependency"]]));
  expect(Math.max(...l.nodes.map((n) => n.x))).toBeLessThan(l.width);
});
