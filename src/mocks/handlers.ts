import { http, HttpResponse } from "msw";
import type { Bootstrap, Coverage, Envelope, ErrorEnvelope, Page, Scope } from "../api/wire/proposed";
import { overview, search, SERVER_TIME, SESSIONS } from "./inspectionData";
import { scenario, withFixtureCapabilities } from "./scenarios";
import { fixtureTerminalId, terminalHandlers } from "./terminal";
import { resultsHandlers } from "./results";
import { humanGraphHandlers, fixtureProject, FIXTURE_ATTEMPT_SESSIONS } from "./humanGraph";
import { decisionHandlers } from "./decisions";
import { swarmHandlers } from "./swarm";
import { withDecisionFixtures } from "./decisionFixtures";
import { questionHandlers, withQuestionFixtures } from "./questions";
import { enrollmentHandlers, swarmActionHandlers } from "./swarmActions";
import { PLAYBOOK_CAPABILITIES, playbookActionHandlers, playbookCapabilities, playbookHandlers, playbookMode } from "./playbooks";

export function envelope<T>(data: T, scope: Scope = { kind: "all_authorized" }, coverage: Coverage = { state: "complete" }): Envelope<T> {
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

/** Session terminal refs re-pointed at labelled fixture terminals (UUID ids, as the wire requires). */
const FIXTURE_SESSIONS = SESSIONS.map((x, i) => (x.terminal ? { ...x, terminal: { ...x.terminal, id: fixtureTerminalId(i) } } : x));
const FIXTURE_TERMINALS = new Map(FIXTURE_SESSIONS.flatMap((x) => (x.terminal ? [[x.terminal.id, x.label] as const] : [])));

/**
 * MSW handlers serving PROPOSED fixtures for one scenario. `fixtures` adds the
 * labelled terminal, Results and Playbooks fixtures and their capabilities; the mock app
 * turns it on, unit tests keep the default contract bootstrap.
 */
export function handlersFor(name: string | null | undefined, { fixtures = false }: { fixtures?: boolean } = {}) {
  const s = scenario(name);
  const sessions = fixtures ? FIXTURE_SESSIONS : SESSIONS;
  // `?scenario=questions` (fixture mode) adds the labelled F5 agent questions to the decision inbox.
  const questions = fixtures && name === "questions";
  const decisionBootstrap = fixtures ? withDecisionFixtures(withFixtureCapabilities(s.bootstrap, s.media)) : s.bootstrap;
  const bootstrap = questions ? withQuestionFixtures(decisionBootstrap) : decisionBootstrap;
  const playbookNames: readonly string[] = fixtures ? PLAYBOOK_CAPABILITIES : [];
  const playbookCaps = fixtures ? playbookCapabilities(playbookMode(name)) : [];
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
    ...decisionHandlers({ reads: s.reads, conflict: name === "decision-conflict", principal: bootstrap.principal.id }),
    ...(fixtures ? [...terminalHandlers(FIXTURE_TERMINALS), ...resultsHandlers({ media: s.media })] : []),
    ...(questions ? questionHandlers() : []),
    ...humanGraphHandlers(s.reads, s.graph),
    ...swarmHandlers(s.reads),
    ...swarmActionHandlers(),
    ...enrollmentHandlers(),
    ...(fixtures ? [...playbookHandlers(playbookMode(name)), ...playbookActionHandlers()] : []),
    http.get("/api/v1/projects", () => HttpResponse.json(envelope({items:[{id:fixtureProject.id,label:fixtureProject.name}],next_cursor:null,has_more:false,snapshot_id:"fixture-projects",total:{value:1,accuracy:"exact"}}))),
    http.get("/api/projects", () => HttpResponse.json({ items: [], next_cursor: null })),
    // Grant the human-graph reads, the labelled playbook fixtures (fixture mode) and, unless the scenario declares otherwise, the fixture project list.
    http.get("/api/v1/bootstrap", () => HttpResponse.json(envelope<Bootstrap>({...bootstrap,capabilities:[...bootstrap.capabilities.filter(c=>c.name!=="human.graph.read"&&c.name!=="knowledge.read"&&c.name!=="tasks.comments.read"&&!playbookNames.includes(c.name)),{name:"human.graph.read",version:"1",enabled:true},{name:"knowledge.read",version:"1",enabled:true},{name:"tasks.comments.read",version:"1",enabled:true},...playbookCaps,...(bootstrap.capabilities.some(c=>c.name==="projects.read")?[]:[{name:"projects.read",version:"1",enabled:true}])]}))),
    http.get("/api/v1/provider-usage", () =>
      s.providerUsage.kind === "ok"
        ? HttpResponse.json(s.providerUsage.body)
        : HttpResponse.json(s.providerUsage.body, { status: s.providerUsage.status }),
    ),
    http.get("/api/v1/overview", ({ request }) => {
      const scope = scopeOf(new URL(request.url));
      return read(() => overview(projectOf(scope), s.reads === "empty"), scope);
    }),
    http.get("/api/v1/sessions", ({ request }) => {
      const url = new URL(request.url);
      const scope = scopeOf(url);
      const project = projectOf(scope);
      const items = s.reads === "empty" ? [] : sessions.filter((x) => !project || x.project.id === project);
      return read(() => paginate(items, url, "snap-sessions-1"), scope);
    }),
    http.get("/api/v1/sessions/:id", ({ params, request }) => {
      // The detail echoes the requested scope, as AQ does; a session outside it reads as missing.
      const scope = scopeOf(new URL(request.url)), project = projectOf(scope);
      return read(() => [...sessions, ...FIXTURE_ATTEMPT_SESSIONS].find((x) => x.id === String(params.id) && (!project || x.project.id === project)) ?? null, scope);
    }),
    http.get("/api/v1/search", ({ request }) => {
      const url = new URL(request.url);
      const scope = scopeOf(url);
      return read(() => search(url.searchParams.get("q") ?? "", projectOf(scope)), scope);
    }),
  ];
}
