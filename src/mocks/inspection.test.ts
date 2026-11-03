import { setupServer } from "msw/node";
import {
  adaptOverview,
  adaptPage,
  adaptSession,
} from "../api/adapters/inspection";
import { adaptGraphPage, adaptGraphDetail, adaptGraphNeighborhood } from "../api/adapters/humanGraph";
import { fixtureProject } from "./humanGraph";
import { apiGet } from "../api/client";
import type {
  Envelope,
  Overview,
  Page,
  SearchResults,
  SessionSummary,
} from "../api/wire/proposed";
import { handlersFor } from "./handlers";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const get = <T,>(path: string) => apiGet<Envelope<T>>(path);

test("pinned Graph task payloads satisfy the served read adapters", async () => {
  const page=adaptGraphPage(await apiGet(`/api/human/projects/${fixtureProject.id}/tasks`),fixtureProject.id,"task");
  expect(page.data.items).toHaveLength(10);
  const id=page.data.items[0]!.id;
  expect(adaptGraphDetail(await apiGet(`/api/human/projects/${fixtureProject.id}/tasks/${id}`),fixtureProject.id,"task",id).data.id).toBe(id);
  expect(adaptGraphNeighborhood(await apiGet(`/api/human/projects/${fixtureProject.id}/tasks/${id}/graph`),fixtureProject.id,id).data.edges.map(e=>e.edge_type)).toEqual(expect.arrayContaining(["blocks","parent-child","references"]));
});
test("unknown Graph project is a neutral 404", async () => {
  await expect(apiGet("/api/human/projects/unknown/tasks")).rejects.toMatchObject({status:404});
});
test("remaining mock payloads satisfy their adapters", async () => {
  adaptOverview((await get<Overview>("/api/v1/overview")).data);
  const sessions=await get<Page<SessionSummary>>("/api/v1/sessions");
  adaptPage(sessions.data,s=>adaptSession(s,sessions.server_time));
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
  await expect(apiGet(`/api/human/projects/${fixtureProject.id}/tasks`)).rejects.toMatchObject({ status: 503 });
});

test("search matches titles case-insensitively and caps hits per group", async () => {
  const r = await get<SearchResults>("/api/v1/search?q=RECOVERY");
  const tasks = r.data.groups.find((g) => g.type === "task");
  expect(tasks?.hits.length).toBeGreaterThan(0);
  expect(tasks!.hits.length).toBeLessThanOrEqual(5);
  expect(tasks!.hits.every((h) => /recovery/i.test(h.title))).toBe(true);
});
