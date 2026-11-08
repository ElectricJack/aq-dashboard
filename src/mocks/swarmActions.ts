import { http, HttpResponse } from "msw";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";

const KINDS = ["worker.start", "worker.stop", "worker.drain", "worker.revoke", "swarm.availability.set"];

/**
 * Mock-mode `worker.*` and `swarm.availability.set` operations through the action union: admission is
 * pending, the first lookup confirms with a labelled fixture receipt. Other kinds fall through untouched.
 */
export function swarmActionHandlers() {
  const seen = new Map<string, unknown>();
  const respond = (id: string, disposition: "pending" | "confirmed", subject: unknown) =>
    HttpResponse.json({ ...operationFixture, data: { ...operationFixture.data, operation_id: id, disposition,
      scope: { kind: "all_authorized" }, subject_refs: [subject],
      receipt_refs: disposition === "confirmed" ? [{ type: "swarm_operation", id }] : [], affected_entities: [],
      recovery: disposition === "confirmed" ? "none" : "lookup_original" } }, { status: disposition === "pending" ? 202 : 200 });
  return [
    http.post("/api/v1/actions", async ({ request }) => {
      const body = (await request.clone().json().catch(() => null)) as { operation_id?: string; kind?: string; subject?: unknown } | null;
      if (!body?.kind || !KINDS.includes(body.kind) || !body.operation_id) return undefined;
      seen.set(body.operation_id, body.subject);
      return respond(body.operation_id, "pending", body.subject);
    }),
    http.get("/api/v1/operations/:id", ({ params }) => {
      const subject = seen.get(String(params.id));
      return subject ? respond(String(params.id), "confirmed", subject) : undefined;
    }),
  ];
}
