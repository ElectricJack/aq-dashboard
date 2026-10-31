import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError, apiGet, apiSend } from "./client";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("GET returns parsed JSON without the CSRF header", async () => {
  let header: string | null = "unset";
  server.use(
    http.get("/api/v1/thing", ({ request }) => {
      header = request.headers.get("X-AQ-Request");
      return HttpResponse.json({ ok: true });
    }),
  );
  await expect(apiGet("/api/v1/thing")).resolves.toEqual({ ok: true });
  expect(header).toBeNull();
});

test("non-GET requests send X-AQ-Request: 1 and a JSON body", async () => {
  let seen: { header: string | null; body: unknown } | undefined;
  server.use(
    http.post("/api/v1/actions", async ({ request }) => {
      seen = { header: request.headers.get("X-AQ-Request"), body: await request.json() };
      return HttpResponse.json({ disposition: "pending" }, { status: 202 });
    }),
  );
  await apiSend("POST", "/api/v1/actions", { operation_id: "op-1" });
  expect(seen).toEqual({ header: "1", body: { operation_id: "op-1" } });
});

test("a server error envelope becomes an http ApiError carrying the envelope", async () => {
  server.use(
    http.get("/api/v1/thing", () =>
      HttpResponse.json(
        { request_id: "r", code: "conflict", message: "Changed", retryable: false },
        { status: 409 },
      ),
    ),
  );
  const err = await apiGet("/api/v1/thing").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ kind: "http", status: 409, envelope: { code: "conflict" } });
});

test("an HTML response is a contract error, never data", async () => {
  server.use(http.get("/api/v1/thing", () => HttpResponse.html("<html></html>")));
  await expect(apiGet("/api/v1/thing")).rejects.toMatchObject({ kind: "contract" });
});

test("a network failure is a transport error whose effect is unknown", async () => {
  server.use(http.post("/api/v1/actions", () => HttpResponse.error()));
  await expect(apiSend("POST", "/api/v1/actions", {})).rejects.toMatchObject({
    kind: "transport",
    effectUnknown: true,
  });
});

test("a failed GET has no unknown effect", async () => {
  server.use(http.get("/api/v1/thing", () => HttpResponse.error()));
  await expect(apiGet("/api/v1/thing")).rejects.toMatchObject({
    kind: "transport",
    effectUnknown: false,
  });
});
