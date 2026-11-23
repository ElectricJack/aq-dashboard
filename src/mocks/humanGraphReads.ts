import { http, HttpResponse, type PathParams } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import { GRAPH_PAGE_SIZE, type GraphNode } from "../api/adapters/humanGraph";
import {
  countStates,
  FIXTURE_ATTEMPTS,
  FIXTURE_RAN_WITH as RAN_WITH,
  historyFor,
  ID,
  knowledge,
  neighborhood,
  parentOf,
} from "./humanGraphData";
import {
  missing,
  unavailable,
  wrap,
  graphPath as path,
  type GraphReads,
  type GraphState,
} from "./humanGraphState";
type GraphRequest = { params: PathParams; request: Request };

function cursorOffset(url: URL) {
  const cursor = url.searchParams.get("cursor");
  return cursor ? Number(atob(cursor).split(":")[1]) || 0 : 0;
}
function holdingExecution(node: { id: string }) {
  const attempt = FIXTURE_ATTEMPTS[node.id]?.find((a) => a.holds_task);
  return attempt
    ? {
        task_id: node.id,
        attempt_id: attempt.attempt_id,
        session_id: attempt.session_id,
        status: attempt.status,
        ran_with: RAN_WITH,
      }
    : null;
}
function listQuery(request: Request) {
  const url = new URL(request.url),
    q = url.searchParams.get("q")?.toLowerCase() ?? "";
  const limit = Math.min(
    GRAPH_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("limit")) || GRAPH_PAGE_SIZE),
  );
  const offset = cursorOffset(url);
  return { q, limit, offset };
}
function collectionNodes(collection: PathParams[string], tasks: GraphNode[]) {
  if (collection === "tasks") return tasks;
  if (collection === "knowledge") return [knowledge];
  return [];
}
function listExecutions(collection: PathParams[string], items: GraphNode[]) {
  if (collection !== "tasks") return {};
  return {
    executions: items.flatMap((node) => {
      const execution = holdingExecution(node);
      return execution ? [execution] : [];
    }),
  };
}
function nextCursor(kind: string, offset: number, total: number) {
  return offset < total ? btoa(`${kind}:${offset}`) : null;
}
function graphCollection(
  { params, request }: GraphRequest,
  reads: GraphReads,
  { tasks, withRole }: GraphState,
) {
  if (!["tasks", "knowledge"].includes(String(params.collection))) return missing();
  if (reads === "failed") return unavailable();
  if (params.project !== fixture.project.id) return missing();
  const { q, limit, offset } = listQuery(request);
  const nodes =
    reads === "empty"
      ? []
      : collectionNodes(params.collection, tasks).filter((node) => node.title.toLowerCase().includes(q));
  const next = offset + limit,
    items = nodes.slice(offset, next).map(withRole);
  // List pages carry the holding executions for the listed tasks (X12).
  return HttpResponse.json(
    wrap({
      items,
      next_cursor: nextCursor("fixture", next, nodes.length),
      ...listExecutions(params.collection, items),
    }),
  );
}
function taskBlockers(node: GraphNode, { edges, tasks }: GraphState) {
  return edges
    .filter((e) => e.target === node.id && e.edge_type === "blocks")
    .map((e) => {
      const b = tasks.find((n) => n.id === e.source);
      return {
        edge_id: e.id,
        id: e.source,
        title: b?.title ?? null,
        task_state: b?.task_state ?? null,
        satisfied: b ? b.task_state === "completed" : null,
      };
    });
}
function readinessState(
  node: GraphNode,
  stopped: boolean,
  holding: boolean,
  blockers: ReturnType<typeof taskBlockers>,
) {
  if (node.task_state !== "active") return node.task_state;
  if (stopped) return "held";
  if (holding) return "running";
  return blockers.some((b) => !b.satisfied) ? "waiting" : "ready";
}
function taskWork(node: GraphNode, graph: GraphState) {
  const { tasks, edges, roleOf, routingOf } = graph;
  const blockers = taskBlockers(node, graph);
  const execution = holdingExecution(node);
  // aq-server #99: an attempt that has finished but still holds the task makes it "held", with AQ's reason.
  const stopped = !!execution && ["finished", "declined", "never_granted"].includes(execution.status);
  const reasons = stopped
    ? [
        {
          code: "attempt_stopped_not_released",
          attempt_id: execution!.attempt_id,
          status: execution!.status,
          message:
            "Fixture: the attempt finished and stopped; the claim stays until its result is settled, the task is retried or the attempt is abandoned.",
        },
      ]
    : [];
  const state = readinessState(node, stopped, !!execution, blockers);
  const routing = routingOf(node.id, String(state));
  return HttpResponse.json(
    wrap({
      task_id: node.id,
      task_state: node.task_state,
      version: node.version,
      role: roleOf(node.id),
      readiness: { state, blockers, complete: true, reasons },
      parent: parentOf(node.id, tasks, edges),
      execution,
      ...(routing ? { routing } : {}),
    }),
  );
}
function withTask(
  params: GraphRequest["params"],
  reads: GraphReads,
  state: GraphState,
  respond: (node: GraphNode) => Response,
) {
  if (reads === "failed") return unavailable();
  const node = state.tasks.find((n) => n.id === params.id);
  if (params.project !== fixture.project.id || !node) return missing();
  return respond(node);
}
function history(node: GraphNode, request: Request) {
  // aq-server 09ee5e98: each attempt with a `ran_with` record carries it here too; the fixture's ended attempts have none.
  // Recorded attempts (history read): "Replay reconciliation" holds one; "Worker recovery" had one that ended; the rest never had one.
  const all = historyFor(node),
    offset = cursorOffset(new URL(request.url)),
    next = offset + 25;
  return HttpResponse.json(
    wrap({
      task_id: node.id,
      items: all.slice(offset, next),
      next_cursor: nextCursor("history", next, all.length),
      attempts: (FIXTURE_ATTEMPTS[node.id] ?? []).map((a) =>
        a.holds_task ? { ...a, ran_with: RAN_WITH } : a,
      ),
      attempts_truncated: false,
    }),
  );
}
function validPageSize(limit: number) {
  return limit >= 1 && limit <= 100;
}
function taskComments({ params, request }: GraphRequest, reads: GraphReads, { comments }: GraphState) {
  if (reads === "failed") return unavailable();
  if (params.project !== fixture.project.id) return missing();
  const url = new URL(request.url),
    limit = Number(url.searchParams.get("limit") ?? 50),
    offset = cursorOffset(url);
  if (!(Number.isInteger(limit) && validPageSize(limit)))
    return HttpResponse.json(
      { request_id: "fixture", code: "invalid", message: "Invalid limit", retryable: false },
      { status: 400 },
    );
  const all = reads === "empty" ? [] : (comments.get(String(params.id)) ?? []),
    next = offset + limit;
  return HttpResponse.json(
    wrap({
      task_id: params.id,
      items: all.slice(offset, next),
      next_cursor: nextCursor("comments", next, all.length),
    }),
  );
}
function taskDetail({ params, request }: GraphRequest, reads: GraphReads, { tasks, withRole }: GraphState) {
  if (reads === "failed") return unavailable();
  if (params.project !== fixture.project.id) return missing();
  const node = collectionNodes(params.collection, tasks).find((node) => node.id === params.id);
  const revision = new URL(request.url).searchParams.get("revision");
  if (!node) return missing();
  if (revision && revision !== node.content_revision) return missing();
  const detail = withRole(node);
  return HttpResponse.json(wrap(requesterDetail(node, detail)));
}
function requesterDetail(node: GraphNode, detail: GraphNode) {
  return node.kind === "task" && node.id === ID.approve
    ? {
        ...detail,
        requested_by: {
          name: "fixture.requester",
          email: "fixture.requester@engineering-operations.example.test",
        },
      }
    : detail;
}
export function graphReadHandlers(reads: GraphReads, state: GraphState) {
  const { tasks, edges } = state;
  return [
    http.get(`${path}/:collection`, (req) => graphCollection(req, reads, state)),
    http.get(`${path}/tasks/:id/graph`, ({ params }) =>
      withTask(params, reads, state, (node) => {
        const result = neighborhood(node.id, tasks, edges);
        return HttpResponse.json(wrap({ ...result, truncated: result.truncated || reads === "partial" }));
      }),
    ),
    http.get(`${path}/tasks/:id/work`, ({ params }) =>
      withTask(params, reads, state, (node) => taskWork(node, state)),
    ),
    http.get(`${path}/tasks/:id/history`, ({ params, request }) =>
      withTask(params, reads, state, (node) => history(node, request)),
    ),
    http.get(`${path}/tasks/:id/comments`, (req) => taskComments(req, reads, state)),
  ];
}
export function graphDetailHandlers(reads: GraphReads, state: GraphState) {
  const { routeLog, descendants } = state;
  return [
    http.get("/api/tasks/:id/routes", ({ params }) =>
      HttpResponse.json({ items: routeLog.get(String(params.id)) ?? [] }),
    ),
    http.get(`${path}/tasks/:id/summary`, ({ params }) =>
      withTask(params, reads, state, (node) => {
        const kids = descendants(node.id);
        return HttpResponse.json(
          wrap({
            task_id: node.id,
            scope: "descendants",
            implementation: { total: String(kids.length), by_state: countStates(kids), complete: true },
            delivery: { state: "unavailable", owner: "D1" },
          }),
        );
      }),
    ),
    http.get(`${path}/:collection/:id`, (req) => taskDetail(req, reads, state)),
  ];
}
