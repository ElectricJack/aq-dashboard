import { http, HttpResponse } from "msw";
import type { IntelligenceProfile, IntelligenceSaved, SaveIntelligence } from "../api/intelligenceSettings";
import type { ActivePlaybook, LatestRun, PlaybookChange, SourceView } from "../api/playbookSources";
import { ROUTING_BINDING, ROUTING_SOURCE_ID } from "../api/routing";

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

/** How long a labelled fixture authoring run takes. */
const RUN_MS = 800;
const FIXTURE_CASES: ActivePlaybook["cases"] = [
  { name: "bug-fix-first-try", situation: "Fixture: a bug fix on its first attempt", result: "class: standard\neffort: high", passed: true },
  { name: "bug-fix-failed-once", situation: "Fixture: a bug fix that failed once", result: "class: complex\neffort: high\nharness: Claude or Codex", passed: true },
  { name: "docs", situation: "Fixture: a documentation fix", result: "class: simple\neffort: low", passed: true },
  { name: "research", situation: "Fixture: research that is not clearly harder than usual", result: "class: standard\neffort: high", passed: true },
  { name: "high-risk", situation: "Fixture: very high risk work, not covered by a test", result: "class: complex\neffort: high", passed: true },
  { name: "high-risk-covered", situation: "Fixture: very high risk work that is narrow and covered by a test", result: "class: standard\neffort: high", passed: true },
];
const DAY_MS = 86_400_000;
/** Forty labelled cases with four distinct results: the most the server sends, and enough to be grouped. */
const MANY_CASES: ActivePlaybook["cases"] = Array.from({ length: 40 }, (_, i) => ({
  name: `case-${i}`, situation: `Fixture: situation ${i + 1}, a ${["bug fix", "documentation fix", "research task", "risky change"][i % 4]} that arrives ${i % 3 === 0 ? "for the first time" : "after a failure"}`,
  result: ["class: simple\neffort: low", "class: standard\neffort: high", "class: complex\neffort: high\nharness: Claude or Codex", "class: deep\neffort: max"][i % 4]!, passed: i !== 5,
}));
/** With a change there is a previous playbook: the comparison is an object and a rollback is offered. */
const fixtureActive = (at: number, change: PlaybookChange | null, cases = FIXTURE_CASES, artifact = "fixture-artifact"): ActivePlaybook => ({
  artifact, since_ms: at, comparison: change ? { change } : null, can_rollback: change !== null,
  previous: change ? { since_ms: at - DAY_MS, summary: "Fixture: the playbook before this one." } : null, cases,
});
const fixtureRun = (status: LatestRun["status"], at: number, extra: Partial<LatestRun> = {}): LatestRun => ({
  run: "fixture-run", status, question: null, unable: [], refusal: null, internal_task_id: null, created_at_ms: at, finished_at_ms: status === "running" ? null : at + RUN_MS, ...extra,
});
const FIXTURE_QUESTION = { question: "Fixture: These two sentences ask for opposite things for research that is only a little harder than usual. Which one wins?", sentences: [
  { line: 3, text: "Fixture: Research is Standard, high effort, unless it is clearly harder." },
  { line: 9, text: "Fixture: Research is always Complex." },
] };
const at0 = Date.UTC(2026, 10, 12, 9, 0, 0);
/** Labelled fixture sources by scenario (`running`, `saved`, `question`, `unable` and `refused` each stand for one state the owner can see); with none, nothing has been authored yet. */
function initialSource(scenario?: string | null): SourceView {
  const base = { id: ROUTING_SOURCE_ID, kind: "builtin", binding: ROUTING_BINDING };
  const now = Date.now();
  switch (scenario) {
    case "playbook-running": return { ...base, active: null, latest: fixtureRun("running", now - 95_000) };
    case "playbook-saved": return { ...base, active: fixtureActive(at0, "behaviour"), latest: fixtureRun("saved", at0 - RUN_MS) };
    case "playbook-many": return { ...base, active: fixtureActive(at0, "behaviour", MANY_CASES), latest: fixtureRun("saved", at0 - RUN_MS) };
    case "playbook-question": return { ...base, active: fixtureActive(at0, "wording"), latest: fixtureRun("question", at0, { question: FIXTURE_QUESTION }) };
    case "playbook-unable": return { ...base, active: null, latest: fixtureRun("unable", at0, { unable: [{ sentence: "Fixture: Art and visual design go to the plotter.", line: 12, reason: "Fixture: There is no plotter among the abilities this playbook can use." }] }) };
    case "playbook-refused": return { ...base, active: fixtureActive(at0, "none"), latest: fixtureRun("refused", at0, { refusal: "Fixture: The document asks to send task text to an outside address, which routing may not do." }) };
    default: return { ...base, active: null, latest: null };
  }
}

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
  let source: SourceView = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-source`) || "null") || initialSource(scenario); } catch { return initialSource(scenario); } })();
  let enabled: boolean = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-enabled`) || "false") === true; } catch { return false; } })();
  /** The playbook that was in effect before the newest one, kept so a rollback can put it back. */
  let previous: ActivePlaybook | null = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-previous`) || "null"); } catch { return null; } })();
  const keepSource = () => { sessionStorage.setItem(`${key}-source`, JSON.stringify(source)); sessionStorage.setItem(`${key}-enabled`, JSON.stringify(enabled)); sessionStorage.setItem(`${key}-previous`, JSON.stringify(previous)); };
  /** A fixture run finishes `RUN_MS` after it started and saves a playbook. */
  const settle = () => {
    const latest = source.latest, now = Date.now();
    if (latest?.status !== "running" || now - latest.created_at_ms < RUN_MS || scenario === "playbook-running") return;
    previous = source.active;
    source = { ...source, active: fixtureActive(now, source.active ? "behaviour" : null), latest: { ...latest, status: "saved", finished_at_ms: now } };
    keepSource();
  };
  const routingView = () => ({ enabled, active: null, latest: null });
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
    http.get("/api/settings/intelligence/routing", () => HttpResponse.json(routingView())),
    http.post("/api/settings/intelligence/routing", async ({ request }) => {
      const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
      if (!body || typeof body.enabled !== "boolean") return fail(400, "Invalid routing switch.");
      settle();
      if (body.enabled && !source.active) return fail(409, "Routing can be turned on once a routing playbook is active");
      enabled = body.enabled;
      keepSource();
      return HttpResponse.json(routingView());
    }),
    http.get("/api/playbooks/sources", () => { settle(); return HttpResponse.json({ items: [source] }); }),
    http.get("/api/playbooks/sources/:id", ({ params }) => { settle(); return params.id === ROUTING_SOURCE_ID ? HttpResponse.json(source) : fail(404, "Source not found."); }),
    http.post("/api/playbooks/sources/:id/rollback", ({ params }) => {
      settle();
      if (params.id !== ROUTING_SOURCE_ID || !source.active?.can_rollback) return fail(409, "There is no previous playbook to roll back to.");
      source = { ...source, active: { ...(previous ?? fixtureActive(source.active.since_ms - DAY_MS, null)), comparison: null, can_rollback: false, previous: null } };
      previous = null;
      keepSource();
      return HttpResponse.json(source);
    }),
    http.post("/api/playbooks/sources/:id/runs", ({ params }) => {
      if (params.id !== ROUTING_SOURCE_ID) return fail(404, "Source not found.");
      source = { ...source, latest: fixtureRun("running", Date.now()) };
      keepSource();
      return HttpResponse.json(source);
    }),
    http.delete("/api/playbooks/sources/:id", () => fail(409, "The routing source cannot be deleted.")),
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
      // The server starts an authoring run for a changed document; a newer save replaces a run still in flight.
      if (compile) {
        source = { ...source, latest: fixtureRun("running", Date.now()) };
        keepSource();
      }
      const response = { ...snapshot, operation_id: body.operation_id, disposition: "saved" };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
