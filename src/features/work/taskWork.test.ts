import task from "../../../contracts/live/human-graph/examples/task.json";
import comments from "../../../contracts/live/human-graph/examples/comments.json";
import commentAdd from "../../../contracts/live/dashboard-actions/fixtures/request-task-comment-add.json";
import commentEdit from "../../../contracts/live/dashboard-actions/fixtures/request-task-comment-edit.json";
import commentDelete from "../../../contracts/live/dashboard-actions/fixtures/request-task-comment-delete.json";
import { adaptGraphNeighborhood, adaptGraphPage } from "../../api/adapters/humanGraph";
import { adaptTaskComments, adaptTaskHistory, adaptTaskSummary, adaptTaskWork, commentProblem } from "./taskWork";
import { freezeComment } from "./inspector/commentActions";
import { listStatus } from "./labels";

const project = task.project.id, id = task.data.id;
const env = (data: unknown) => ({ ...task, data });
const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;

test("neighborhood keeps parent, omitted counts and expansion (item 6), and still reads an older server", () => {
  const base = { root_id: id, nodes: [task.data], edges: [], truncated: true };
  const omitted = { tasks: "12", tasks_by_state: { draft: "9", active: "3", completed: "0", canceled: "0", unknown: "0" }, other_nodes: "1", edges: "14", exact: false };
  const parent = { id: uuid(9), kind: "task", title: "Epic", task_state: "active", edge_id: uuid(10) };
  const g = adaptGraphNeighborhood(env({ ...base, parent, omitted, expansion: { limit: "63" } }), project, id).data;
  expect(g.parent).toEqual(parent); expect(g.omitted).toEqual(omitted); expect(g.expansion).toEqual({ limit: "63" });
  const old = adaptGraphNeighborhood(env(base), project, id).data;
  expect([old.parent, old.omitted, old.expansion]).toEqual([null, null, null]);
  expect(() => adaptGraphNeighborhood(env({ ...base, omitted: { ...omitted, tasks: "-1" } }), project, id)).toThrow();
  expect(() => adaptGraphNeighborhood(env({ ...base, parent: { ...parent, edge_id: "x" } }), project, id)).toThrow();
});

test("list pages keep executions so a held task reads running (item 16)", () => {
  const execution = { task_id: id, attempt_id: uuid(20), session_id: uuid(21), status: "running" };
  const page = adaptGraphPage(env({ items: [task.data], next_cursor: null, executions: [execution] }), project, "task").data;
  expect(page.executions).toEqual([execution]);
  expect(adaptGraphPage(env({ items: [task.data], next_cursor: null }), project, "task").data.executions).toEqual([]);
  expect(listStatus({ task_state: "active" }, true)).toBe("running");
  expect(listStatus({ task_state: "active" }, false)).toBe("active");
  expect(listStatus({ task_state: "completed" }, false)).toBe("completed");
  expect(listStatus({ task_state: null }, false)).toBe("unknown");
  expect(() => adaptGraphPage(env({ items: [task.data], next_cursor: null, executions: [execution, execution] }), project, "task")).toThrow();
});

test("work read: readiness state, blocker titles and parent; an older server reads as unknown, never ready (item 2)", () => {
  const work = { task_id: id, task_state: "active", version: "1", readiness: { state: "waiting", blockers: [{ edge_id: uuid(30), id: uuid(31), title: "Lease", task_state: "active", satisfied: false }], complete: true }, parent: { id: uuid(9), kind: null, title: null, task_state: null, edge_id: uuid(10) }, execution: null };
  const w = adaptTaskWork(env(work), project, id).data;
  expect(w.state).toBe("waiting"); expect(w.blockers[0]!.title).toBe("Lease"); expect(w.parent?.title).toBeNull();
  const { state: _state, ...readiness } = work.readiness;
  expect(adaptTaskWork(env({ ...work, readiness }), project, id).data.state).toBe("unknown");
  expect(() => adaptTaskWork(env({ ...work, readiness: { ...work.readiness, state: "blocked" } }), project, id)).toThrow();
});

test("history read: entries and attempts (items 4, 5)", () => {
  const h = { task_id: id, items: [{ sequence: "7", entry_id: uuid(40), category: "lifecycle", operation: "set_task_state", actor_id: "owner@example.test", reason: null, created_at: "2026-11-06T10:00:00Z" }], next_cursor: "c", attempts: [{ attempt_id: uuid(41), session_id: uuid(42), holds_task: true, status: "running" }], attempts_truncated: false };
  const page = adaptTaskHistory(env(h), project, id).data;
  expect(page.items[0]!.operation).toBe("set_task_state"); expect(page.attempts[0]!.holds_task).toBe(true);
  expect(() => adaptTaskHistory(env({ ...h, items: [{ ...h.items[0], category: "other" }] }), project, id)).toThrow();
  expect(() => adaptTaskHistory(env({ ...h, attempts: [h.attempts[0], h.attempts[0]] }), project, id)).toThrow();
});

test("summary read: descendant counts (item 6)", () => {
  const s = { task_id: id, scope: "descendants", implementation: { total: "3", by_state: { draft: "1", active: "1", completed: "1", canceled: "0", unknown: "0" }, complete: false }, delivery: { state: "unavailable", owner: "D1" } };
  expect(adaptTaskSummary(env(s), project, id).data).toEqual({ total: "3", by_state: s.implementation.by_state, complete: false });
  expect(() => adaptTaskSummary(env({ ...s, scope: "children" }), project, id)).toThrow();
});

test("comments: the pinned human-graph example adapts, tombstones carry no body (item 13)", () => {
  const thread = adaptTaskComments(comments, comments.project.id, comments.data.task_id).data;
  expect(thread.items.map(c => c.author.kind)).toEqual(["owner", "owner", "agent"]);
  expect(thread.items[1]!.body).toBeNull(); expect(thread.items[1]!.can_edit).toBe(false);
  expect(thread.next_cursor).toBe("opaque-encrypted-cursor");
  const live = comments.data.items[0]!;
  expect(() => adaptTaskComments({ ...comments, data: { ...comments.data, items: [{ ...live, body: null }] } }, comments.project.id, comments.data.task_id)).toThrow();
  expect(() => adaptTaskComments({ ...comments, data: { ...comments.data, items: [{ ...live, author: { ...live.author, kind: "robot" } }] } }, comments.project.id, comments.data.task_id)).toThrow();
});

test("comment writes freeze to the pinned dashboard-actions request shapes (item 13)", () => {
  const strip = (v: { operation_id: string; payload: Record<string, unknown> }) => ({ ...v, operation_id: "x", payload: { ...v.payload, operation_id: "x" } });
  const add = JSON.parse(freezeComment({ kind: "task.comment.add", project: commentAdd.payload.project_id, task: commentAdd.subject.id, body: commentAdd.payload.body }).bytes);
  expect(strip(add)).toEqual(strip(commentAdd));
  const edit = JSON.parse(freezeComment({ kind: "task.comment.edit", project: commentEdit.payload.project_id, comment: commentEdit.subject.id, revision: commentEdit.subject.revision, body: commentEdit.payload.body }).bytes);
  expect(strip(edit)).toEqual(strip(commentEdit));
  const del = JSON.parse(freezeComment({ kind: "task.comment.delete", project: commentDelete.payload.project_id, comment: commentDelete.subject.id, revision: commentDelete.subject.revision }).bytes);
  expect(strip(del)).toEqual(strip(commentDelete));
  expect(add.payload.operation_id).toBe(add.operation_id);
});

test("comment bodies: nonblank, at most 16 KiB of UTF-8, no control characters", () => {
  expect(commentProblem("  ")).toMatch(/Write a comment/);
  expect(commentProblem("é".repeat(8193))).toMatch(/16 KB/);
  expect(commentProblem("ok\u0007")).toMatch(/control/);
  expect(commentProblem("line one\n\tline two\r\n")).toBeNull();
});
