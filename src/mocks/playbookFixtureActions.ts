import {http,HttpResponse} from "msw";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
const respond = (id: string, disposition: "pending" | "confirmed", entry: { subject: unknown; project: string }) =>
    HttpResponse.json({ ...operationFixture, data: { ...operationFixture.data, operation_id: id, disposition,
      scope: { kind: "project", project_id: entry.project }, subject_refs: [entry.subject],
      receipt_refs: disposition === "confirmed" ? [{ type: "playbook_operation", id }] : [], affected_entities: [],
      recovery: disposition === "confirmed" ? "none" : "lookup_original" } }, { status: disposition === "pending" ? 202 : 200 });

/**
 * Mock-mode `playbook.*` operations through the action union: admission is pending, the
 * first lookup confirms with a labelled fixture receipt. Other kinds fall through untouched.
 */
export function playbookActionHandlers() {
  const seen = new Map<string, { subject: unknown; project: string }>();
  return [
    http.post("/api/v1/actions", async ({ request }) => {
      const body = (await request.clone().json().catch(() => null)) as { operation_id?: string; kind?: string; subject?: unknown; payload?: { project_id?: string } } | null;
      if (!body?.kind?.startsWith("playbook.") || !body.operation_id) return undefined;
      const entry = seen.get(body.operation_id) ?? { subject: body.subject, project: body.payload?.project_id ?? "" };
      seen.set(body.operation_id, entry);
      return respond(body.operation_id, "pending", entry);
    }),
    http.get("/api/v1/operations/:id", ({ params }) => {
      const entry = seen.get(String(params.id));
      return entry ? respond(String(params.id), "confirmed", entry) : undefined;
    }),
  ];
}
