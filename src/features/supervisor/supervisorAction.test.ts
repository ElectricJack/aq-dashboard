import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { freezeSupervisorMessage } from "../../api/adapters/supervisor";
import { supervisorActor, supervisorDiscovery, supervisorActionReceipt, supervisorId } from "../../test/supervisor";
import ownerRequest from "../../../contracts/live/dashboard-actions/fixtures/request-supervisor-message-send.json";
import ownerOperation from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { supervisorAction, supervisorActionBytes } from "./supervisorAction";
const server = setupServer();
beforeAll(() => server.listen()); beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); }); afterAll(() => server.close());
test("G1b exact action retries and lookup preserve operation/message/body; acknowledgement is only enqueue", async () => {
  const intent = await freezeSupervisorMessage(supervisorDiscovery.conversation, supervisorActor, "Original exact message");
  const bytes = supervisorActionBytes(intent), seen: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { seen.push(await request.text()); return HttpResponse.json(supervisorActionReceipt(bytes)); }),
    http.get(`/api/v1/operations/${intent.operation}`, async ({ request }) => { expect(await request.text()).toBe(""); return HttpResponse.json(supervisorActionReceipt(bytes)); }));
  const run = (mode: "post" | "lookup") => supervisorAction(mode, intent.conversation, intent.operation, intent.message, new AbortController().signal, intent);
  expect(await run("post")).toMatchObject({ disposition: "confirmed" }); await run("post"); await run("lookup");
  expect(seen).toEqual([bytes, bytes]); expect(JSON.parse(bytes).payload.message_id).toBe(intent.message);
});
test("G1b refuses confirmation with changed subject, digest or missing mailbox/message evidence", async () => {
  const intent = await freezeSupervisorMessage(supervisorDiscovery.conversation, supervisorActor, "Original message");
  const receipt = supervisorActionReceipt(supervisorActionBytes(intent));
  for (const patch of [{ request_digest: `sha256:${"0".repeat(64)}` }, { subject_refs: [{ type: "conversation", id: supervisorId(99) }] }, { receipt_refs: [] }, { affected_entities: [] }, { scope: { kind: "project", project_id: supervisorId(99) } }, { created_at: "invalid" }]) {
    server.use(http.post("/api/v1/actions", () => HttpResponse.json({ ...receipt, data: { ...receipt.data, ...patch } })));
    await expect(supervisorAction("post", intent.conversation, intent.operation, intent.message, new AbortController().signal, intent)).rejects.toThrow();
  }
});

test("consumes the unchanged G1b published Supervisor request and retained confirmation", async () => {
  const bytes = JSON.stringify(ownerRequest.payload);
  const intent = { conversation: ownerRequest.subject.id, revision: ownerRequest.subject.revision, actor: supervisorActor, operation: ownerRequest.operation_id, message: ownerRequest.payload.message_id, bytes, requestDigest: "", bodyDigest: "" };
  server.use(http.post("/api/v1/actions", () => HttpResponse.json(ownerOperation)));
  expect(await supervisorAction("post", intent.conversation, intent.operation, intent.message, new AbortController().signal, intent)).toMatchObject(ownerOperation.data);
});
