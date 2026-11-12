import { http, HttpResponse } from "msw";
import type { IntelligenceProfile, IntelligenceSaved, SaveIntelligence } from "../api/intelligenceSettings";

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
      snapshot = { revision: String(Number(snapshot.revision) + 1), catalog_revision: snapshot.catalog_revision, routing_markdown: body.routing_markdown, parents: body.parents, assignments: body.assignments };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      const response = { ...snapshot, operation_id: body.operation_id, disposition: "saved" };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
