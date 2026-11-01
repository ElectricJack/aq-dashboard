import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { supervisorRequest } from "./supervisorClient";
import { supervisorDiscovery, supervisorReceipt, supervisorId } from "../test/supervisor";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const path = "/api/human/conversations/test/messages";
const bytes = JSON.stringify({ operation_id: supervisorId(2), message_id: supervisorId(3), expected_conversation_revision: "1", body: "Literal request", context: [], attachments: [] });
const post = () => supervisorRequest("POST", path, new AbortController().signal, bytes);
test("preserves literal frozen POST and normal CSRF request header", async () => {
  server.use(http.post(path, async ({ request }) => {
    expect(await request.text()).toBe(bytes); expect(request.headers.get("X-AQ-Request")).toBe("1"); expect(request.credentials).toBe("same-origin");
    return HttpResponse.json(supervisorReceipt(bytes));
  }));
  expect(await post()).toEqual(supervisorReceipt(bytes));
});
test("only the exact typed not-queued POST409 is a retained refusal", async () => {
  server.use(http.post(path, () => HttpResponse.json(supervisorReceipt(bytes, "not_queued"), { status: 409 })));
  expect(await post()).toMatchObject({ state: "not_queued" });
  server.use(http.post(path, () => HttpResponse.json({ error: "conflict" }, { status: 409 })));
  await expect(post()).rejects.toMatchObject({ status: 409, effectUnknown: true });
});
test.each([401, 403, 503])("POST%s retains error status and ambiguous effect", async status => {
  server.use(http.post(path, () => new HttpResponse(null, { status })));
  await expect(post()).rejects.toMatchObject({ status, effectUnknown: true });
});
test("lookup404 is body-free and cannot claim a write effect", async () => {
  server.use(http.get(path, async ({ request }) => { expect(await request.text()).toBe(""); return new HttpResponse(null, { status: 404 }); }));
  await expect(supervisorRequest("GET", path, new AbortController().signal)).rejects.toMatchObject({ status: 404, effectUnknown: false });
});
test("non-JSON200 and oversized history retain the existing contract fence", async () => {
  server.use(http.get(path, () => HttpResponse.html("<h1>Sign in</h1>")));
  await expect(supervisorRequest("GET", path, new AbortController().signal)).rejects.toHaveProperty("name", "ContractError");
  server.use(http.get(path, () => new HttpResponse(" ".repeat(262145), { headers: { "Content-Type": "application/json" } })));
  await expect(supervisorRequest("GET", path, new AbortController().signal)).rejects.toHaveProperty("name", "ContractError");
  server.use(http.post(path, () => HttpResponse.json(supervisorDiscovery)));
  await expect(post()).rejects.toHaveProperty("name", "ContractError");
});
