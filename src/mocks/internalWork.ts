import { http, HttpResponse } from "msw";
import type { InternalWorkPurpose, SaveInternalWork } from "../api/internalWork";

type Snapshot = { revision: string; catalog_revision: string; default_profile_id: string | null; overrides: Partial<Record<InternalWorkPurpose, string>>; purposes: InternalWorkPurpose[] };
const PURPOSES: InternalWorkPurpose[] = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"];
const FIXTURE_PROFILES = ["fixture-standard", "fixture-advanced"];

/** Labelled fixture state for internal work settings; survives reload in the same browser tab. */
export function internalWorkHandlers() {
  const key = "aq-mock-internal-work";
  const initial = (): Snapshot => ({ revision: "0", catalog_revision: "1", default_profile_id: null, overrides: {}, purposes: PURPOSES });
  let snapshot: Snapshot = (() => { try { return JSON.parse(sessionStorage.getItem(key) || "null") || initial(); } catch { return initial(); } })();
  const operations = new Map<string, { request: string; response: Snapshot & { operation_id: string; disposition: string } }>();
  const fail = (status: number, message: string) => HttpResponse.json({ error: "internal_work", message }, { status });
  return [
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
      if (ids.some(id => !FIXTURE_PROFILES.includes(id as string)) || Object.keys(body.overrides).some(purpose => !PURPOSES.includes(purpose as InternalWorkPurpose))) return fail(400, "Choose an Intelligence profile that exists and is not automatic routing.");
      const changed = JSON.stringify({ d: body.default_profile_id, o: body.overrides }) !== JSON.stringify({ d: snapshot.default_profile_id, o: snapshot.overrides });
      snapshot = { ...snapshot, revision: changed ? String(Number(snapshot.revision) + 1) : snapshot.revision, default_profile_id: body.default_profile_id, overrides: body.overrides };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      const response = { ...snapshot, operation_id: body.operation_id, disposition: changed ? "saved" : "unchanged" };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
