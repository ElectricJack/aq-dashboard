import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { ApiError } from "./client";
import { inspectRoutingDocumentSave, readRoutingDocument, saveRoutingDocument } from "./routingDocument";

// The server keeps the routing document inside its structure record; the client shows only the text and its revision.
const STORE = "/api/settings/intelligence/structure";
const held = () => ({ revision: "4", catalog_revision: "12", routing_markdown: "\n# Policy\n\n- Simple → bounded work 🙂\n\n", parents: [{ id: "simple", description: "Simple work" }], assignments: [] as unknown[] });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const operation = "00000000-0000-4000-8000-000000000001";

test("reads the exact Markdown and its revision, and nothing else", async () => {
  server.use(http.get(STORE, () => HttpResponse.json(held())));
  expect(await readRoutingDocument()).toEqual({ markdown: held().routing_markdown, revision: "4" });
});
test("a malformed revision or a text over 128 KiB of UTF-8 fails the read", async () => {
  for (const bad of [{ ...held(), revision: "01" }, { ...held(), routing_markdown: 5 }, { ...held(), routing_markdown: "🙂".repeat(40_000) }, null]) {
    server.use(http.get(STORE, () => HttpResponse.json(bad)));
    await expect(readRoutingDocument()).rejects.toThrow(ContractError);
  }
  server.use(http.get(STORE, () => HttpResponse.json({ ...held(), routing_markdown: "a".repeat(128 * 1024) })));
  await expect(readRoutingDocument()).resolves.toMatchObject({ revision: "4" });
});
test("a save sends the new text at the revision asked for, with the rest of the record exactly as the server holds it", async () => {
  const bodies: unknown[] = [];
  server.use(http.get(STORE, () => HttpResponse.json(held())), http.post(STORE, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; bodies.push(body);
    return HttpResponse.json({ ...held(), revision: "5", routing_markdown: body.routing_markdown, operation_id: body.operation_id, disposition: "saved" });
  }));
  expect(await saveRoutingDocument({ markdown: "# New\n", expected_revision: "4", operation_id: operation })).toEqual({ markdown: "# New\n", revision: "5", disposition: "saved" });
  expect(bodies).toEqual([{ operation_id: operation, expected_revision: "4", expected_catalog_revision: "12", routing_markdown: "# New\n", parents: held().parents, assignments: [] }]);
});
test("a save for a revision the server no longer holds is a conflict, and nothing is sent", async () => {
  let posts = 0;
  server.use(http.get(STORE, () => HttpResponse.json({ ...held(), revision: "9" })), http.post(STORE, () => { posts++; return HttpResponse.json({}); }));
  const failure = await saveRoutingDocument({ markdown: "x", expected_revision: "4", operation_id: operation }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError); expect((failure as ApiError).status).toBe(409); expect(posts).toBe(0);
});
test("retrying a save whose answer was lost sends the same bytes, even when the record has moved on", async () => {
  const bodies: string[] = []; let record = held(), fail = true;
  server.use(http.get(STORE, () => HttpResponse.json(record)), http.post(STORE, async ({ request }) => {
    const text = await request.text(); bodies.push(text);
    if (fail) return HttpResponse.error();
    return HttpResponse.json({ ...record, operation_id: operation, disposition: "saved" });
  }));
  const request = { markdown: "# Kept\n", expected_revision: "4", operation_id: "00000000-0000-4000-8000-000000000002" };
  await expect(saveRoutingDocument(request)).rejects.toBeInstanceOf(ApiError);
  record = { ...held(), revision: "5", routing_markdown: "# Kept\n" }; fail = false;
  server.use(http.post(STORE, async ({ request: retry }) => { bodies.push(await retry.text()); return HttpResponse.json({ ...record, operation_id: request.operation_id, disposition: "saved" }); }));
  expect(await saveRoutingDocument(request)).toMatchObject({ revision: "5", disposition: "saved" });
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
});
test("the outcome of a save is read by its operation id; another operation's answer is refused", async () => {
  server.use(http.get(`${STORE}/operations/:id`, ({ params }) => HttpResponse.json({ ...held(), operation_id: params.id === operation ? operation : "other", disposition: "unchanged" })));
  expect(await inspectRoutingDocumentSave(operation)).toEqual({ markdown: held().routing_markdown, revision: "4", disposition: "unchanged" });
  await expect(inspectRoutingDocumentSave("00000000-0000-4000-8000-000000000003")).rejects.toThrow(ContractError);
});
