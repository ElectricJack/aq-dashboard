import { setupServer } from "msw/node";
import {
  adaptOverview,
  adaptPage,
  adaptSession,
  adaptTaskDetail,
  adaptTaskGraph,
  adaptTaskSummary,
} from "../api/adapters/inspection";
import { ApiError, apiGet } from "../api/client";
import type {
  Envelope,
  Overview,
  Page,
  SearchResults,
  SessionSummary,
  TaskDetail,
  TaskGraph,
  TaskSummary,
} from "../api/wire/proposed";
import { handlersFor } from "./handlers";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const get = <T,>(path: string) => apiGet<Envelope<T>>(path);

test("task pages are bounded and chain by cursor without repeats", async () => {
  const first = await get<Page<TaskSummary>>("/api/v1/tasks?limit=25");
  expect(first.data.items).toHaveLength(25);
  expect(first.data.has_more).toBe(true);
  const second = await get<Page<TaskSummary>>(
    `/api/v1/tasks?limit=25&cursor=${encodeURIComponent(first.data.next_cursor!)}`,
  );
  const ids = [...first.data.items, ...second.data.items].map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(second.data.snapshot_id).toBe(first.data.snapshot_id);
});

test("limit is capped at 100", async () => {
  const page = await get<Page<TaskSummary>>("/api/v1/tasks?limit=1000");
  expect(page.data.items.length).toBeLessThanOrEqual(100);
});

test("project scope filters tasks and is echoed in the envelope", async () => {
  const page = await get<Page<TaskSummary>>("/api/v1/tasks?scope=project%3Amatter-engine&limit=100");
  expect(page.data.items.length).toBeGreaterThan(0);
  expect(page.data.items.every((t) => t.project.id === "matter-engine")).toBe(true);
  expect(page.scope).toEqual({ kind: "project", project_id: "matter-engine" });
});

test("readiness filter narrows tasks", async () => {
  const page = await get<Page<TaskSummary>>("/api/v1/tasks?readiness=running&limit=100");
  expect(page.data.items.every((t) => t.readiness.state === "running")).toBe(true);
});

test("every mock payload satisfies the adapters", async () => {
  const tasks = await get<Page<TaskSummary>>("/api/v1/tasks?limit=100");
  adaptPage(tasks.data, adaptTaskSummary);
  const id = tasks.data.items[0]!.id;
  adaptTaskDetail((await get<TaskDetail>(`/api/v1/tasks/${id}`)).data);
  adaptTaskGraph((await get<TaskGraph>(`/api/v1/tasks/${id}/graph`)).data);
  adaptOverview((await get<Overview>("/api/v1/overview")).data);
  const sessions = await get<Page<SessionSummary>>("/api/v1/sessions");
  adaptPage(sessions.data, (s) => adaptSession(s, sessions.server_time));
  const search = await get<SearchResults>("/api/v1/search?q=recovery");
  expect(search.data.groups.length).toBeGreaterThan(0);
});

test("an unknown task id is a neutral 404", async () => {
  const err = await apiGet("/api/v1/tasks/nope").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(404);
  expect((err as ApiError).envelope?.message).not.toContain("nope");
});

test("partial scenario reports partial overview coverage", async () => {
  server.use(...handlersFor("partial"));
  expect((await get<Overview>("/api/v1/overview")).coverage.state).toBe("partial");
});

test("empty scenario returns a complete overview with no attention items", async () => {
  server.use(...handlersFor("empty"));
  const o = await get<Overview>("/api/v1/overview");
  expect(o.coverage.state).toBe("complete");
  expect(o.data.attention).toEqual([]);
});

test("reads-failed scenario fails domain reads with 503", async () => {
  server.use(...handlersFor("reads-failed"));
  await expect(apiGet("/api/v1/overview")).rejects.toMatchObject({ status: 503 });
  await expect(apiGet("/api/v1/tasks")).rejects.toMatchObject({ status: 503 });
});

test("search matches titles case-insensitively and caps hits per group", async () => {
  const r = await get<SearchResults>("/api/v1/search?q=RECOVERY");
  const tasks = r.data.groups.find((g) => g.type === "task");
  expect(tasks?.hits.length).toBeGreaterThan(0);
  expect(tasks!.hits.length).toBeLessThanOrEqual(5);
  expect(tasks!.hits.every((h) => /recovery/i.test(h.title))).toBe(true);
});
