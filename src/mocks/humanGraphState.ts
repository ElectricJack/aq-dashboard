import { HttpResponse, type JsonBodyType } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import type { GraphNode, GraphEdge } from "../api/adapters/humanGraph";
import {
  ID,
  fixtureComments,
  type FixtureRouteEntry,
  fixtureTasks,
  fixtureEdges,
  largeTasks,
  largeEdges,
} from "./humanGraphData";

export type GraphReads = "ok" | "partial" | "empty" | "failed";
export type GraphSize = "standard" | "large";
export const graphPath = "/api/human/projects/:project";
export const unavailable = () =>
  HttpResponse.json(
    { request_id: "fixture", code: "unavailable", message: "Read unavailable", retryable: true },
    { status: 503 },
  );
export const missing = () =>
  HttpResponse.json(
    {
      request_id: "fixture",
      code: "not_found",
      message: "This item does not exist or is not available to you.",
      retryable: false,
    },
    { status: 404 },
  );
export const wrap = (data: unknown) => ({ ...fixture, data });
function fixtureRouting() {
  // Labelled fixture routing (spec 0011 §8, shaped as aq-server serves it): these two tasks sit under an automatic router.
  // "Replay reconciliation" was routed by the router; "Approve recovery plan" is ready with no route, so it waits for routing; "Implement safe recovery" is a draft with no route (unrouted).
  const routed = [ID.approve, ID.replay, ID.implement],
    serverNow = Date.parse(fixture.observed_at);
  const routeLog = new Map<string, FixtureRouteEntry[]>([
    [
      ID.replay,
      [
        {
          sequence: 1,
          at_ms: serverNow - 12 * 60_000,
          route: {
            class: "standard-high",
            harnesses: [],
            providers: [],
            prefer: ["claude-code"],
            lane: "backend",
            provider_intent: "any",
            reasons: [
              { code: "lane_matched", detail: "Fixture: the task touches the backend lane." },
              {
                code: "class_raised_for_risk",
                detail: "Fixture: risk was assessed as high, so the class was raised to high effort.",
              },
            ],
            classification: null,
            policy_digest: null,
            structure_revision: 1,
            source: "router",
          },
        },
      ],
    ],
  ]);
  const routingOf = (taskId: string, state: string) => {
    const current = routeLog.get(taskId)?.[0];
    if (current?.route) {
      const {
        reasons: _reasons,
        classification: _classification,
        structure_revision: _revision,
        ...route
      } = current.route;
      return { state: "routed", route, since_ms: current.at_ms };
    }
    return !routed.includes(taskId)
      ? undefined
      : state === "ready"
        ? { state: "waiting", since_ms: serverNow - 4 * 60_000 }
        : { state: "unrouted" };
  };
  return { routeLog, routingOf, serverNow };
}
function fixtureRoles() {
  // Task roles (aq-server spec 0014 §5.5): a task names a role, or runs as the fixture project's default, `developer`.
  const named = new Map<string, string>();
  const roleOf = (task: string) =>
    named.has(task)
      ? { id: named.get(task)!, source: "task" }
      : { id: "developer", source: "project_default" };
  const withRole = <T extends { id: string; kind: string }>(node: T) =>
    node.kind === "task" ? { ...node, role: roleOf(node.id) } : node;
  return { named, roleOf, withRole };
}
// Labelled fixture activations survive a reload in the same browser tab, as an AQ write would: the activated tasks'
// state/version and each operation's exact request bytes and receipt (so a replay or lookup after reload returns the original).
type KeptActivation = {
  tasks: Record<string, { task_state: string; version: string }>;
  operations: [string, { requestBytes: string; body: JsonBodyType }][];
};
function storedActivation(activationKey: string): KeptActivation {
  try {
    const kept = JSON.parse(
      globalThis.sessionStorage?.getItem(activationKey) || "null",
    ) as KeptActivation | null;
    return kept && typeof kept.tasks === "object" && Array.isArray(kept.operations)
      ? kept
      : { tasks: {}, operations: [] };
  } catch {
    return { tasks: {}, operations: [] };
  }
}
function fixtureActivation(tasks: GraphNode[], graph: GraphSize) {
  const activationKey = `aq-mock-task-activation:${graph}`;
  const keptActivation = storedActivation(activationKey);
  for (const task of tasks) {
    const kept = keptActivation.tasks[task.id];
    if (kept) {
      task.task_state = kept.task_state;
      task.version = kept.version;
    }
  }
  const activationOperations = new Map<string, { requestBytes: string; body: JsonBodyType }>(
    keptActivation.operations,
  );
  const keepActivation = (changed: GraphNode[]) => {
    for (const task of changed)
      keptActivation.tasks[task.id] = { task_state: String(task.task_state), version: task.version };
    keptActivation.operations = [...activationOperations];
    try {
      globalThis.sessionStorage?.setItem(activationKey, JSON.stringify(keptActivation));
    } catch {
      /* fixture state stays in memory */
    }
  };
  return { activationOperations, keepActivation };
}
function descendantTasks(root: string, tasks: GraphNode[], edges: GraphEdge[]) {
  const seen = new Set([root]),
    pending = [root];
  while (pending.length) {
    const parent = pending.pop();
    for (const edge of edges) {
      if (edge.edge_type !== "parent-child" || edge.source !== parent) continue;
      if (seen.has(edge.target)) continue;
      seen.add(edge.target);
      pending.push(edge.target);
    }
  }
  return tasks.filter((task) => task.id !== root && seen.has(task.id));
}
export function graphState(graph: GraphSize) {
  const tasks = (graph === "large" ? largeTasks : fixtureTasks).map((task) => ({ ...task })),
    edges = graph === "large" ? largeEdges : fixtureEdges;
  return {
    tasks,
    edges,
    comments: fixtureComments(),
    ...fixtureRouting(),
    ...fixtureRoles(),
    ...fixtureActivation(tasks, graph),
    descendants: (root: string) => descendantTasks(root, tasks, edges),
  };
}
export type GraphState = ReturnType<typeof graphState>;
