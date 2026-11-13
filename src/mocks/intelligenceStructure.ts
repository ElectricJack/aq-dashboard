import { http, HttpResponse } from "msw";
import type { IntelligenceProfile, IntelligenceSaved, SaveIntelligence } from "../api/intelligenceSettings";
import type { RoutingActive, RoutingLatest, RoutingPolicyState } from "../api/routing";

type ParentId = "simple" | "standard" | "complex" | "deep";
type Effort = "low" | "medium" | "high" | "max";
type Snapshot = {
  revision: string;
  catalog_revision: string;
  routing_markdown: string;
  parents: { id: ParentId; description: string }[];
  assignments: { profile_id: string; parent_id: ParentId; effort: Effort }[];
};
type Save = Snapshot & { operation_id: string; expected_revision: string; expected_catalog_revision: string };

const initial = (): Snapshot => ({
  revision: "1", catalog_revision: "1", routing_markdown: "# Intelligence routing\n\nChoose the appropriate intelligence level for each task.",
  parents: [
    { id: "simple", description: "Straightforward work" },
    { id: "standard", description: "Typical work" },
    { id: "complex", description: "Demanding work" },
    { id: "deep", description: "Deep analysis" },
  ],
  assignments: [
    { profile_id: "fixture-standard", parent_id: "standard", effort: "low" },
    { profile_id: "fixture-advanced", parent_id: "standard", effort: "high" },
  ],
});

/** How long a labelled fixture compile takes. */
const COMPILE_MS = 800;
const FIXTURE_SUMMARY = [
  "Fixture: Bug fixes: Standard, high effort; Complex, high effort after 1 failed attempt.",
  "Fixture: High risk: at least Standard, high effort; Claude or Codex only.",
  "Fixture: Low risk: no minimum level; any offered harness may take it.",
];
const fixtureActive = (revision: number, at: number): RoutingActive => ({ digest: `sha256:${"f".repeat(64)}`, structure_revision: revision, summary: FIXTURE_SUMMARY, created_at_ms: at - COMPILE_MS, took_effect_at_ms: at, problems: [] });
const FIXTURE_PROBLEM = { path: "kinds.docs.class", message: "Fixture: Standard, high effort is above the highest level for this kind, Standard, medium effort" };
const FIXTURE_UNRESOLVED = "Fixture: Art and visual design go to the plotter.";
/** Shaped like GET /api/settings/intelligence/routing for a compile that failed validation and named a sentence it could not resolve. */
const fixtureFailed = (revision: number, at: number): RoutingLatest => ({
  status: "failed", structure_revision: revision, problems: [FIXTURE_PROBLEM], unresolved: [FIXTURE_UNRESOLVED],
  error: `${FIXTURE_PROBLEM.path}: ${FIXTURE_PROBLEM.message}\nCould not be resolved: ${FIXTURE_UNRESOLVED}`, internal_task_id: null, created_at_ms: at - COMPILE_MS, finished_at_ms: at,
});
/** `routing-compile-failed` starts with an active fixture policy and a failed later compile, and fails every compile; otherwise nothing has compiled yet and every compile succeeds. */
const initialRouting = (scenario?: string | null): RoutingPolicyState => {
  const at = Date.UTC(2026, 10, 12, 9, 0, 0);
  return scenario === "routing-compile-failed" ? { enabled: true, active: fixtureActive(0, at), latest: fixtureFailed(1, at) } : { enabled: false, active: null, latest: null };
};

/** Isolated fixture state survives a page reload in the same browser tab. */
export function intelligenceStructureHandlers(scenario?: string | null) {
  const key = "aq-mock-intelligence-structure";
  let snapshot: Snapshot = (() => {
    try { return JSON.parse(sessionStorage.getItem(key) || "null") || initial(); } catch { return initial(); }
  })();
  let profileRevision = 1;
  let profiles: IntelligenceProfile[] = ["standard", "advanced"].map(name => ({ id: `fixture-${name}`, version: 1, name: `Fixture ${name}`, description: "Labelled fixture profile", candidates: [{ id: `fixture-${name}`, provider: "fixture-provider", model: "fixture-model", reasoning_configuration_reference: "fixture-balanced@1", harnesses: ["fixture-harness"] }], projects: [] }));
  if (scenario === "swarm-two-providers") profiles.push({ id: "fixture-standard-two", version: 1, name: "Fixture second standard", description: "Labelled fixture profile", candidates: [{ id: "fixture-standard-two", provider: "fixture-provider-two", model: "fixture-model", reasoning_configuration_reference: "fixture-balanced@1", harnesses: ["fixture-harness"] }], projects: [] });
  try { profiles = JSON.parse(sessionStorage.getItem(`${key}-profiles`) || "null") || profiles; profileRevision = Number(sessionStorage.getItem(`${key}-profile-revision`) || 1); } catch { /* Fresh fixture state. */ }
  const profileOperations = new Map<string, { request: string; response: IntelligenceSaved }>();
  const operations = new Map<string, { request: string; response: Snapshot & { operation_id: string; disposition: string } }>();
  const fail = (status: number, message: string) => HttpResponse.json({ error: "intelligence_structure", message }, { status });
  let routing: RoutingPolicyState = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-routing`) || "null") || initialRouting(scenario); } catch { return initialRouting(scenario); } })();
  const keepRouting = () => sessionStorage.setItem(`${key}-routing`, JSON.stringify(routing));
  /** A fixture compile finishes `COMPILE_MS` after it started. */
  const settle = () => {
    const latest = routing.latest, now = Date.now();
    if (latest?.status !== "compiling" || now - latest.created_at_ms < COMPILE_MS) return;
    routing = scenario === "routing-compile-failed"
      ? { ...routing, latest: { ...fixtureFailed(latest.structure_revision, now), created_at_ms: latest.created_at_ms } }
      : { ...routing, active: fixtureActive(latest.structure_revision, now), latest: { ...latest, status: "active", finished_at_ms: now } };
    keepRouting();
  };
  return [
    http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: String(profileRevision), active_digest: "a".repeat(64), profiles, model_choices: [{ provider: "fixture-provider", model: "fixture-model", reasoning_configuration_reference: "fixture-balanced@1", reasoning: "Fixture balanced", harness: "fixture-harness" }] })),
    http.get("/api/settings/intelligence/operations/:id", ({ params }) => {
      const entry = profileOperations.get(String(params.id));
      return entry ? HttpResponse.json(entry.response) : fail(404, "Operation not found.");
    }),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json().catch(() => null) as SaveIntelligence | null;
      if (!body || typeof body.operation_id !== "string") return fail(400, "Invalid operation ID.");
      const serialized = JSON.stringify(body), previous = profileOperations.get(body.operation_id);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
      if (body.expected_revision !== String(profileRevision)) return fail(409, "Profiles changed; reload and try again.");
      const old = profiles.find(p => p.id === body.profile_id);
      if ((old?.version ?? 0) !== body.profile_version) return fail(409, "Profile changed; reload and try again.");
      const profile = { id: body.profile_id, version: body.profile_version + 1, name: body.name, description: body.description, candidates: body.candidates };
      profiles = profiles.filter(p => p.id !== body.profile_id);
      if (!body.delete) profiles.push({ ...profile, projects: old?.projects ?? [] });
      profileRevision++;
      snapshot = { ...snapshot, catalog_revision: String(profileRevision) };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      sessionStorage.setItem(`${key}-profiles`, JSON.stringify(profiles));
      sessionStorage.setItem(`${key}-profile-revision`, String(profileRevision));
      const response: IntelligenceSaved = { operation_id: body.operation_id, disposition: body.delete ? "deleted" : "saved", revision: String(profileRevision), active_digest: "a".repeat(64), profile, updated_projects: [] };
      profileOperations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
    http.get("/api/settings/intelligence/structure", () => HttpResponse.json(snapshot)),
    http.get("/api/settings/intelligence/routing", () => { settle(); return HttpResponse.json(routing); }),
    http.post("/api/settings/intelligence/routing", async ({ request }) => {
      const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
      if (!body || typeof body.enabled !== "boolean") return fail(400, "Invalid routing switch.");
      settle();
      if (body.enabled && !routing.active) return fail(409, "Routing can be turned on once a routing policy has compiled");
      routing = { ...routing, enabled: body.enabled };
      keepRouting();
      return HttpResponse.json(routing);
    }),
    http.get("/api/settings/intelligence/structure/operations/:id", ({ params }) => {
      const operation = operations.get(String(params.id));
      return operation ? HttpResponse.json(operation.response) : fail(404, "Operation not found.");
    }),
    http.post("/api/settings/intelligence/structure", async ({ request }) => {
      const body = await request.json().catch(() => null) as Save | null;
      if (!body || typeof body.operation_id !== "string") return fail(400, "Invalid operation ID.");
      const serialized = JSON.stringify(body), previous = operations.get(body.operation_id);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
      if (body.expected_revision !== snapshot.revision || body.expected_catalog_revision !== snapshot.catalog_revision) return fail(409, "Settings or catalog changed; reload and try again.");
      if (typeof body.routing_markdown !== "string" || !Array.isArray(body.parents) || !Array.isArray(body.assignments)) return fail(400, "Invalid structure.");
      const compile = body.routing_markdown !== snapshot.routing_markdown;
      snapshot = { revision: String(Number(snapshot.revision) + 1), catalog_revision: snapshot.catalog_revision, routing_markdown: body.routing_markdown, parents: body.parents, assignments: body.assignments };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      if (compile) {
        routing = { ...routing, latest: { status: "compiling", structure_revision: Number(snapshot.revision), error: null, problems: [], unresolved: [], internal_task_id: null, created_at_ms: Date.now(), finished_at_ms: null } };
        keepRouting();
      }
      const response = { ...snapshot, operation_id: body.operation_id, disposition: "saved" };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
