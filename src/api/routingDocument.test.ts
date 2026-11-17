import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { ApiError } from "./client";
import { inspectRoutingDocumentSave, readRoutingDocument, ROUTING_DOCUMENT_PATH, saveRoutingDocument } from "./routingDocument";

// aq-server serves the routing document on its own route: GET {markdown, revision}; PUT {markdown, expected_revision, operation_id} answers {revision, digest}.
const held = () => ({ markdown: "\n# Policy\n\n- Simple → bounded work 🙂\n\n", revision: "4" });
const receipt = (revision: string) => ({ revision, digest: `sha256:${"a".repeat(64)}` });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const operation = "00000000-0000-4000-8000-000000000001";

test("the document is read and saved at /api/settings/routing-document", () => {
  expect(ROUTING_DOCUMENT_PATH).toBe("/api/settings/routing-document");
});
test("reads the exact Markdown and its revision", async () => {
  server.use(http.get(ROUTING_DOCUMENT_PATH, () => HttpResponse.json(held())));
  expect(await readRoutingDocument()).toEqual(held());
  // A store that never saved one: empty text at revision 0.
  server.use(http.get(ROUTING_DOCUMENT_PATH, () => HttpResponse.json({ markdown: "", revision: "0" })));
  expect(await readRoutingDocument()).toEqual({ markdown: "", revision: "0" });
});
test("a malformed revision or a text over 128 KiB of UTF-8 fails the read", async () => {
  for (const bad of [{ ...held(), revision: "01" }, { ...held(), markdown: 5 }, { ...held(), markdown: "🙂".repeat(40_000) }, { routing_markdown: "old shape", revision: "4" }, null]) {
    server.use(http.get(ROUTING_DOCUMENT_PATH, () => HttpResponse.json(bad)));
    await expect(readRoutingDocument()).rejects.toThrow(ContractError);
  }
  server.use(http.get(ROUTING_DOCUMENT_PATH, () => HttpResponse.json({ ...held(), markdown: "a".repeat(128 * 1024) })));
  await expect(readRoutingDocument()).resolves.toMatchObject({ revision: "4" });
});
test("a save is one PUT of the text, the revision it read and its operation id, and nothing else", async () => {
  const requests: { method: string; body: unknown }[] = [];
  server.use(http.all(ROUTING_DOCUMENT_PATH, async ({ request }) => { requests.push({ method: request.method, body: await request.json() }); return HttpResponse.json(receipt("5")); }));
  expect(await saveRoutingDocument({ markdown: "# New\n", expected_revision: "4", operation_id: operation })).toEqual({ markdown: "# New\n", revision: "5", disposition: "saved" });
  // The server refuses unknown fields: no parents, assignments or catalog revision.
  expect(requests).toEqual([{ method: "PUT", body: { markdown: "# New\n", expected_revision: "4", operation_id: operation } }]);
});
test("a save the server refuses as stale is a conflict", async () => {
  server.use(http.put(ROUTING_DOCUMENT_PATH, () => HttpResponse.json({ error: "conflict", message: "The settings changed" }, { status: 409 })));
  const failure = await saveRoutingDocument({ markdown: "x", expected_revision: "4", operation_id: operation }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError); expect((failure as ApiError).status).toBe(409);
  // The refusal ended that save; its outcome is no longer something to check.
  await expect(inspectRoutingDocumentSave(operation)).rejects.toMatchObject({ status: 404 });
});
test("a receipt without a revision is a contract error", async () => {
  server.use(http.put(ROUTING_DOCUMENT_PATH, () => HttpResponse.json({ digest: "x" })));
  await expect(saveRoutingDocument({ markdown: "x", expected_revision: "4", operation_id: "00000000-0000-4000-8000-000000000009" })).rejects.toThrow(ContractError);
});
test("retrying a save whose answer was lost, or checking its outcome, sends the same bytes", async () => {
  const bodies: string[] = []; let fail = true;
  server.use(http.put(ROUTING_DOCUMENT_PATH, async ({ request }) => {
    bodies.push(await request.text());
    return fail ? HttpResponse.error() : HttpResponse.json(receipt("5"));
  }));
  const request = { markdown: "# Kept\n", expected_revision: "4", operation_id: "00000000-0000-4000-8000-000000000002" };
  await expect(saveRoutingDocument(request)).rejects.toBeInstanceOf(ApiError);
  await expect(inspectRoutingDocumentSave(request.operation_id)).rejects.toBeInstanceOf(ApiError);
  fail = false;
  // The check is the same save again: the server answers a repeated operation as it did the first time.
  expect(await inspectRoutingDocumentSave(request.operation_id)).toEqual({ markdown: "# Kept\n", revision: "5", disposition: "saved" });
  expect(bodies).toHaveLength(3); expect(new Set(bodies).size).toBe(1);
  expect(JSON.parse(bodies[0]!)).toEqual(request);
});
test("a save this page did not send cannot be checked", async () => {
  await expect(inspectRoutingDocumentSave("00000000-0000-4000-8000-000000000003")).rejects.toMatchObject({ status: 404 });
});
