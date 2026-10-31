import { http, HttpResponse } from "msw";
import type { Bootstrap, Coverage, Envelope, ErrorEnvelope, Page, Scope } from "../api/wire/proposed";
import { overview, search, SERVER_TIME, SESSIONS, TASKS, taskDetail, taskGraph } from "./inspectionData";
import { scenario } from "./scenarios";

function envelope<T>(data: T, scope: Scope = { kind: "all_authorized" }, coverage: Coverage = { state: "complete" }): Envelope<T> {
  return {
    api_version: "proposed-0",
    request_id: "mock",
    server_time: SERVER_TIME,
    scope,
    data,
    observation: {
      observed_at: SERVER_TIME,
      fresh_until: "2026-10-31T12:01:00.000Z",
      source: "mock",
      quality: "reported",
      coverage: coverage.state,
    },
    pending_operations: [],
    coverage,
  };
}

function error(status: number, code: string, message: string) {
  const body: ErrorEnvelope = { request_id: "mock", code, message, retryable: status >= 500 };
  return HttpResponse.json(body, { status });
}

const notFound = () => error(404, "not_found", "This item does not exist or is not available to you.");
const unavailable = () => error(503, "read_model_unavailable", "The read model is temporarily unavailable.");

function scopeOf(url: URL): Scope {
  const raw = url.searchParams.get("scope");
  return raw?.startsWith("project:") && raw.length > 8
    ? { kind: "project", project_id: raw.slice(8) }
    : { kind: "all_authorized" };
}
const projectOf = (scope: Scope) => (scope.kind === "project" ? scope.project_id : null);

/** Offset cursor bound to a snapshot. Opaque to the client. */
function paginate<T>(items: T[], url: URL, snapshot: string): Page<T> {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25) || 25));
  const cursor = url.searchParams.get("cursor");
  const offset = cursor ? Number(atob(cursor).split(":")[1] ?? 0) : 0;
  const slice = items.slice(offset, offset + limit);
  const next = offset + slice.length;
  return {
    items: slice,
    next_cursor: next < items.length ? btoa(`${snapshot}:${next}`) : null,
    has_more: next < items.length,
    snapshot_id: snapshot,
    total: { value: items.length, accuracy: "exact" },
  };
}

/** MSW handlers serving PROPOSED fixtures for one scenario. */
export function handlersFor(name: string | null | undefined) {
  const s = scenario(name);
  const coverage: Coverage =
    s.reads === "partial"
      ? { state: "partial", omitted_count: 1, reason: "One project's read model did not respond" }
      : { state: "complete" };
  const read = <T,>(produce: () => T | null, scope?: Scope) => {
    if (s.reads === "failed") return unavailable();
    const data = produce();
    return data === null ? notFound() : HttpResponse.json(envelope(data, scope, coverage));
  };

  return [
    http.get("/api/v1/bootstrap", () => HttpResponse.json(envelope<Bootstrap>(s.bootstrap))),
    http.get("/api/v1/provider-usage", () =>
      s.providerUsage.kind === "ok"
        ? HttpResponse.json(s.providerUsage.body)
        : HttpResponse.json(s.providerUsage.body, { status: s.providerUsage.status }),
    ),
    http.get("/api/v1/overview", ({ request }) => {
      const scope = scopeOf(new URL(request.url));
      return read(() => overview(projectOf(scope), s.reads === "empty"), scope);
    }),
    http.get("/api/v1/tasks", ({ request }) => {
      const url = new URL(request.url);
      const scope = scopeOf(url);
      const project = projectOf(scope);
      const readiness = url.searchParams.get("readiness");
      const items =
        s.reads === "empty"
          ? []
          : TASKS.filter((t) => (!project || t.project.id === project) && (!readiness || t.readiness.state === readiness));
      return read(() => paginate(items, url, "snap-tasks-1"), scope);
    }),
    http.get("/api/v1/tasks/:id", ({ params }) => read(() => taskDetail(String(params.id)))),
    http.get("/api/v1/tasks/:id/graph", ({ params }) => read(() => taskGraph(String(params.id)))),
    http.get("/api/v1/sessions", ({ request }) => {
      const url = new URL(request.url);
      const scope = scopeOf(url);
      const project = projectOf(scope);
      const items = s.reads === "empty" ? [] : SESSIONS.filter((x) => !project || x.project.id === project);
      return read(() => paginate(items, url, "snap-sessions-1"), scope);
    }),
    http.get("/api/v1/sessions/:id", ({ params }) =>
      read(() => SESSIONS.find((x) => x.id === String(params.id)) ?? null),
    ),
    http.get("/api/v1/search", ({ request }) => {
      const url = new URL(request.url);
      const scope = scopeOf(url);
      return read(() => search(url.searchParams.get("q") ?? "", projectOf(scope)), scope);
    }),
  ];
}
