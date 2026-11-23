import type { GraphNode } from "../api/adapters/humanGraph";
import { http, HttpResponse } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { FIXTURE_ATTEMPTS, id, OWNER, type FixtureComment } from "./humanGraphData";
import { missing, type GraphState } from "./humanGraphState";
const FIXTURE_ROLES = ["developer", "reviewer"],
  NOT_GRANTED = ["offered", "preparing", "declined", "never_granted"];
type GraphAction = {
  operation_id: string;
  kind: string;
  subject: { type: string; id: string; revision?: string };
  expected_versions?: { task?: string };
  payload: {
    project_id: string;
    body?: string;
    expected_revision?: string;
    expected_version?: string;
    class?: string;
    harnesses?: string[];
    providers?: string[];
  };
};

function ownerRoute(limits: { class?: string; harnesses?: string[]; providers?: string[] }) {
  return {
    class: limits.class!,
    harnesses: limits.harnesses ?? [],
    providers: limits.providers ?? [],
    prefer: [],
    lane: null,
    provider_intent: "any",
    reasons: [{ code: "owner_set", detail: "Fixture: the owner set this route." }],
    classification: null,
    policy_digest: null,
    structure_revision: 1,
    source: "owner",
  };
}
function setRoute(body: GraphAction, { routeLog, serverNow }: GraphState) {
  // Owner route actions (spec 0011 §8): the route log is what GET /api/tasks/{id}/routes and the work read serve.
  const log = routeLog.get(body.subject.id) ?? [];
  routeLog.set(body.subject.id, [
    {
      sequence: (log[0]?.sequence ?? 0) + 1,
      at_ms: serverNow,
      route: body.kind === "task.route.set" ? ownerRoute(body.payload) : null,
    },
    ...log,
  ]);
  return routeReceipt(body);
}
function routeReceipt(body: GraphAction) {
  const stamp = new Date().toISOString();
  return HttpResponse.json({
    ...operationFixture,
    scope: { kind: "project", project_id: body.payload.project_id },
    data: {
      ...operationFixture.data,
      operation_id: body.operation_id,
      disposition: "confirmed",
      scope: { kind: "project", project_id: body.payload.project_id },
      subject_refs: [body.subject],
      created_at: stamp,
      updated_at: stamp,
      receipt_refs: [{ type: "graph_change_set", id: id(0x3ff) }],
      affected_entities: [{ type: "task", id: body.subject.id }],
      recovery: "none",
    },
  });
}
function activationDisposition(task: GraphNode, stale: boolean) {
  if (stale) return "conflict";
  return task.task_state === "draft" ? "confirmed" : "rejected";
}
function activationReceipt(body: GraphAction, task: GraphNode) {
  const scope = { kind: "project", project_id: fixture.project.id };
  const now = new Date().toISOString();
  const current = task.version;
  const stale = [body.subject.revision, body.expected_versions?.task, body.payload.expected_version].some(
    (version) => version !== current,
  );
  const disposition = activationDisposition(task, stale);
  const confirmed = disposition === "confirmed";
  if (confirmed) {
    task.task_state = "active";
    task.version = String(BigInt(current) + 1n);
  }
  const receipt = {
    ...operationFixture,
    scope,
    data: {
      ...operationFixture.data,
      operation_id: body.operation_id,
      disposition,
      scope,
      subject_refs: [body.subject],
      created_at: now,
      updated_at: now,
      recovery: confirmed ? "none" : "refresh_and_review",
      receipt_refs: confirmed ? [{ type: "graph_change_set", id: body.operation_id }] : [],
      affected_entities: confirmed ? [{ type: "task", id: task.id, revision: task.version }] : [],
      ...(stale ? { current_versions: { task: current } } : {}),
    },
  };
  return { receipt, confirmed };
}
function replayActivation(
  earlier: { requestBytes: string; body: import("msw").JsonBodyType },
  requestBytes: string,
) {
  if (earlier.requestBytes === requestBytes) return HttpResponse.json(earlier.body);
  return HttpResponse.json(
    {
      request_id: "fixture",
      code: "operation_conflict",
      message: "Operation ID already used for another request",
      retryable: false,
    },
    { status: 409 },
  );
}
async function activate(
  body: GraphAction,
  request: Request,
  { tasks, activationOperations, keepActivation }: GraphState,
) {
  const task = tasks.find((task) => task.id === body.subject.id);
  if (!task) return missing();
  if (body.subject.type !== "task" || body.payload.project_id !== fixture.project.id) return missing();
  const requestBytes = await request.text();
  const earlier = activationOperations.get(body.operation_id);
  if (earlier) {
    return replayActivation(earlier, requestBytes);
  }
  const { receipt, confirmed } = activationReceipt(body, task);
  activationOperations.set(body.operation_id, { requestBytes, body: receipt });
  keepActivation(confirmed ? [task] : []);
  return HttpResponse.json(receipt);
}
function activateSubtree(body: GraphAction, { tasks, descendants, keepActivation }: GraphState) {
  const root = tasks.find((t) => t.id === body.subject.id);
  if (!root || body.payload.project_id !== fixture.project.id) return missing();
  const kids = descendants(root.id),
    activated = kids.filter((task) => task.task_state === "draft");
  for (const task of activated) {
    task.task_state = "active";
    task.version = String(Number(task.version) + 1);
  }
  keepActivation(activated);
  const now = new Date().toISOString();
  return HttpResponse.json({
    ...operationFixture,
    data: {
      ...operationFixture.data,
      operation_id: body.operation_id,
      disposition: "confirmed",
      scope: { kind: "project", project_id: fixture.project.id },
      subject_refs: [body.subject],
      created_at: now,
      updated_at: now,
      recovery: "none",
      receipt_refs: [{ type: "graph_change_set", id: body.operation_id }],
      affected_entities: activated.map((task) => ({ type: "task", id: task.id, revision: task.version })),
      activation: { activated: activated.length, skipped: kids.length - activated.length },
    },
  });
}
function updateRole(named: Map<string, string>, taskId: string, role: string | null) {
  if (role === null) named.delete(taskId);
  else named.set(taskId, role);
}
function setRole(body: GraphAction, { named }: GraphState) {
  // As AQ: the role must exist (422 `unknown_role`), and it is fixed once an attempt of the task was granted (rejected).
  const role = (body.payload as { role?: string | null }).role ?? null,
    stamp = new Date().toISOString();
  if (role !== null && !FIXTURE_ROLES.includes(role))
    return HttpResponse.json(
      {
        request_id: "fixture",
        code: "unknown_role",
        message: `Role \`${role}\` does not exist. The roles are: ${FIXTURE_ROLES.join(", ")}.`,
        retryable: false,
      },
      { status: 422 },
    );
  const granted = FIXTURE_ATTEMPTS[body.subject.id]?.some((a) => !NOT_GRANTED.includes(a.status)) ?? false;
  if (!granted) updateRole(named, body.subject.id, role);
  return roleReceipt(body, stamp, granted);
}
function roleEffect(body: GraphAction, granted: boolean) {
  if (granted) return { receipt_refs: [], affected_entities: [], recovery: "refresh_and_review" };
  return {
    receipt_refs: [{ type: "graph_change_set", id: id(0x3fe) }],
    affected_entities: [{ type: "task", id: body.subject.id }],
    recovery: "none",
  };
}
function roleReceipt(body: GraphAction, stamp: string, granted: boolean) {
  return HttpResponse.json({
    ...operationFixture,
    scope: { kind: "project", project_id: body.payload.project_id },
    data: {
      ...operationFixture.data,
      operation_id: body.operation_id,
      disposition: granted ? "rejected" : "confirmed",
      scope: { kind: "project", project_id: body.payload.project_id },
      subject_refs: [body.subject],
      created_at: stamp,
      updated_at: stamp,
      ...roleEffect(body, granted),
    },
  });
}
function commentEffect(disposition: "confirmed" | "conflict", comment: FixtureComment) {
  if (disposition === "conflict") return { receipt_refs: [], affected_entities: [] };
  const ref = { type: "task_comment", id: comment.comment_id, revision: comment.revision };
  return { receipt_refs: [ref], affected_entities: [ref, { type: "task", id: comment.task_id }] };
}
function commentReceipt(body: GraphAction, now: string) {
  return (disposition: "confirmed" | "conflict", comment: FixtureComment, current?: string) =>
    HttpResponse.json({
      ...operationFixture,
      scope: { kind: "project", project_id: body.payload.project_id },
      data: {
        ...operationFixture.data,
        operation_id: body.operation_id,
        disposition,
        scope: { kind: "project", project_id: body.payload.project_id },
        subject_refs: [body.subject],
        created_at: now,
        updated_at: now,
        ...commentEffect(disposition, comment),
        ...(current ? { current_versions: { task_comment: current } } : {}),
        recovery: disposition === "confirmed" ? "none" : "refresh_and_review",
      },
    });
}
function addComment(
  body: GraphAction,
  comments: GraphState["comments"],
  now: string,
  answer: ReturnType<typeof commentReceipt>,
) {
  const list = comments.get(body.subject.id) ?? [];
  const existing = list.find((c) => c.comment_id === body.operation_id);
  if (existing) return answer("confirmed", existing);
  const added: FixtureComment = {
    comment_id: body.operation_id,
    task_id: body.subject.id,
    author: OWNER,
    body: body.payload.body!,
    created_at: now,
    edited_at: null,
    deleted_at: null,
    revision: "1",
    can_edit: true,
  };
  comments.set(body.subject.id, [added, ...list]);
  return answer("confirmed", added);
}
function commentRefusal(target: FixtureComment) {
  if (target.author.kind !== "owner")
    return HttpResponse.json(
      {
        request_id: "fixture",
        code: "comment_not_author",
        message: "Only the owner who wrote a comment can edit or delete it",
        retryable: false,
      },
      { status: 403 },
    );
  if (target.deleted_at)
    return HttpResponse.json(
      {
        request_id: "fixture",
        code: "comment_deleted",
        message: "This comment was deleted",
        retryable: false,
      },
      { status: 409 },
    );
  return null;
}
function commentAction(body: GraphAction, { comments }: GraphState) {
  const now = new Date().toISOString();
  const answer = commentReceipt(body, now);
  if (body.kind === "task.comment.add") return addComment(body, comments, now, answer);
  const target = [...comments.values()].flat().find((c) => c.comment_id === body.subject.id);
  if (!target) return missing();
  const refusal = commentRefusal(target);
  if (refusal) return refusal;
  if (target.revision !== body.payload.expected_revision) return answer("conflict", target, target.revision);
  target.revision = String(Number(target.revision) + 1);
  if (body.kind === "task.comment.edit") {
    target.body = body.payload.body!;
    target.edited_at = now;
  } else {
    target.body = null;
    target.deleted_at = now;
    target.can_edit = false;
  }
  return answer("confirmed", target);
}
function handleAction(body: GraphAction, request: Request, state: GraphState) {
  switch (body.kind) {
    case "task.route.set":
    case "task.route.clear":
      return setRoute(body, state);
    case "task.activate":
      return activate(body, request, state);
    case "task.activate.subtree":
      return activateSubtree(body, state);
    case "task.role.set":
      return setRole(body, state);
    default:
      return body.kind?.startsWith("task.comment.") ? commentAction(body, state) : undefined;
  }
}
export function graphActionHandlers(state: GraphState) {
  return [
    http.post("/api/v1/actions", async ({ request }) => {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as GraphAction | null;
      return body ? handleAction(body, request, state) : undefined;
    }),
    http.get("/api/v1/operations/:id", ({ params }) => {
      const kept = state.activationOperations.get(String(params.id));
      return kept ? HttpResponse.json(kept.body) : undefined;
    }),
  ];
}
