import { http, HttpResponse } from "msw";
import type { InternalRunData, InternalWorkPurpose, SaveInternalWork } from "../api/internalWork";

type Snapshot = { revision: string; catalog_revision: string; default_profile_id: string | null; overrides: Partial<Record<InternalWorkPurpose, string>>; purposes: InternalWorkPurpose[] };
const PURPOSES: InternalWorkPurpose[] = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"];
/** The fixture catalog served by GET /api/settings/intelligence (see intelligenceStructure.ts); like the real endpoint it holds no automatic router. */
const FIXTURE_PROFILES = ["fixture-standard", "fixture-advanced", "fixture-standard-two"];

const FIXTURE_NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const FIXTURE_RUN_BASE: Pick<InternalRunData, "instructions" | "input" | "affected" | "escalation"> = {
  instructions: "Fixture: classify the task as small or large.", input: "Fixture task: fix the login page", affected: { kind: "task", id: "fixture-task", project_id: null }, escalation: "none",
};
/** Labelled fixture runs shaped exactly like GET /api/internal-work/runs: one answered, one failed. */
const fixtureRuns = (): InternalRunData[] => [
  { ...FIXTURE_RUN_BASE, id: "00000000-0000-4000-8000-0000000000a2", purpose: "routing_classification", status: "failed", reason: "provider_error", detail: "Fixture provider returned HTTP 500",
    attempts: [{ provider: "fixture-provider", model: "fixture-model", way: "api", reason: "provider_error", detail: "HTTP 500", elapsed_ms: 420 }], created_at_ms: FIXTURE_NOW - 60_000, finished_at_ms: FIXTURE_NOW - 59_000 },
  { ...FIXTURE_RUN_BASE, id: "00000000-0000-4000-8000-0000000000a1", purpose: "routing_classification", status: "answered", answer: { choice: "small", rationale: "Fixture rationale." },
    attempts: [{ provider: "fixture-provider", model: "fixture-model", way: "api", reason: null, detail: "", elapsed_ms: 900 }], provider: "fixture-provider", model: "fixture-model", way: "api", elapsed_ms: 900,
    usage: { input_tokens: 120, output_tokens: 18 }, created_at_ms: FIXTURE_NOW - 3_600_000, finished_at_ms: FIXTURE_NOW - 3_599_100 },
];

/** Labelled fixture state for internal work settings; survives reload in the same browser tab. */
export function internalWorkHandlers() {
  const key = "aq-mock-internal-work";
  const initial = (): Snapshot => ({ revision: "0", catalog_revision: "1", default_profile_id: null, overrides: {}, purposes: PURPOSES });
  let snapshot: Snapshot = (() => { try { return JSON.parse(sessionStorage.getItem(key) || "null") || initial(); } catch { return initial(); } })();
  const operations = new Map<string, { request: string; response: Snapshot & { operation_id: string; disposition: string } }>();
  const fail = (status: number, message: string) => HttpResponse.json({ error: "internal_work", message }, { status });
  let runs = fixtureRuns();
  return [
    http.get("/api/internal-work/runs", ({ request }) => {
      const url = new URL(request.url), limit = Number(url.searchParams.get("limit") ?? 50);
      const match = runs.filter(run => (["affected_kind", "affected_id", "purpose", "status"] as const).every(name => {
        const wanted = url.searchParams.get(name);
        return !wanted || (name === "affected_kind" ? run.affected.kind : name === "affected_id" ? run.affected.id : run[name]) === wanted;
      }));
      return HttpResponse.json({ runs: match.slice(0, limit), next_cursor: null });
    }),
    http.get("/api/internal-work/runs/:id", ({ params }) => {
      const run = runs.find(item => item.id === params.id);
      return run ? HttpResponse.json(run) : fail(404, "Internal run not found");
    }),
    http.post("/api/internal-work/runs/:id/retry", ({ params }) => {
      const run = runs.find(item => item.id === params.id);
      if (!run) return fail(404, "Internal run not found");
      if (run.status !== "failed") return fail(409, "Only a failed run can be retried");
      const id = `00000000-0000-4000-8000-${String(0xb00 + runs.length).padStart(12, "0")}`;
      runs = [{ ...FIXTURE_RUN_BASE, id, purpose: run.purpose, status: "queued", affected: run.affected, attempts: [], created_at_ms: FIXTURE_NOW, retry_of: run.id }, ...runs];
      return HttpResponse.json({ id });
    }),
    http.get("/api/settings/internal-work", () => HttpResponse.json(snapshot)),
    http.get("/api/settings/internal-work/operations/:id", ({ params }) => {
      const operation = operations.get(String(params.id));
      return operation ? HttpResponse.json(operation.response) : fail(404, "Save has not been recorded.");
    }),
    http.post("/api/settings/internal-work", async ({ request }) => {
      const body = await request.json().catch(() => null) as SaveInternalWork | null;
      if (!body || typeof body.operation_id !== "string" || typeof body.overrides !== "object" || !body.overrides) return fail(400, "Invalid save.");
      const serialized = JSON.stringify(body), previous = operations.get(body.operation_id);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Save identity was reused with different changes.");
      if (body.expected_revision !== snapshot.revision || body.expected_catalog_revision !== snapshot.catalog_revision) return fail(409, "Internal work settings changed. Your draft is preserved; reload before saving.");
      const ids = [body.default_profile_id, ...Object.values(body.overrides)].filter(id => id !== null);
      if (ids.some(id => !FIXTURE_PROFILES.includes(id as string)) || Object.keys(body.overrides).some(purpose => !PURPOSES.includes(purpose as InternalWorkPurpose))) return fail(400, "Choose an Intelligence profile that exists.");
      const changed = JSON.stringify({ d: body.default_profile_id, o: body.overrides }) !== JSON.stringify({ d: snapshot.default_profile_id, o: snapshot.overrides });
      snapshot = { ...snapshot, revision: changed ? String(Number(snapshot.revision) + 1) : snapshot.revision, default_profile_id: body.default_profile_id, overrides: body.overrides };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      const response = { ...snapshot, operation_id: body.operation_id, disposition: changed ? "saved" : "unchanged" };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
