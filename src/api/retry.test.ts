import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { ApiError, apiGet } from "./client";
import { isRetryableError, pollUnlessSettled, retryDelayMs, shouldRetryRead } from "./retry";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const http_ = (status: number, retryable?: boolean, extra: Partial<ConstructorParameters<typeof ApiError>[2]> = {}) =>
  new ApiError("http", "x", { status, ...(retryable !== undefined && { envelope: { request_id: "r", code: "c", message: "m", retryable } }), ...extra });

test.each([
  ["transport", new ApiError("transport", "x"), true],
  ["429 capacity", http_(429, true), true],
  ["503 unavailable without envelope (human graph)", http_(503), true],
  ["503 retryable", http_(503, true), true],
  ["503 marked non-retryable", http_(503, false), false],
  ["500 without retryable", http_(500), false],
  ["500 retryable", http_(500, true), true],
  ["timeout", new DOMException("t", "TimeoutError"), true],
  ...[400, 401, 403, 404, 409, 410, 422].map((s) => [`${s}`, http_(s), false] as const),
  ["contract", new ContractError("x"), false],
  ["abort", new DOMException("a", "AbortError"), false],
] as const)("%s retryable=%s", (_name, error, expected) => {
  expect(isRetryableError(error)).toBe(expected);
});

test("reads retry at most three times and only retryable failures", () => {
  expect(shouldRetryRead(0, http_(503))).toBe(true);
  expect(shouldRetryRead(2, http_(429, true))).toBe(true);
  expect(shouldRetryRead(3, http_(503))).toBe(false);
  expect(shouldRetryRead(0, http_(422))).toBe(false);
});

test("backoff grows with jitter, is capped, and never undercuts Retry-After", () => {
  expect(retryDelayMs(0, undefined, () => 0)).toBe(250);
  expect(retryDelayMs(0, undefined, () => 1)).toBe(500);
  expect(retryDelayMs(3, undefined, () => 1)).toBe(4000);
  expect(retryDelayMs(10, undefined, () => 1)).toBe(8000);
  expect(retryDelayMs(0, http_(429, true, { retryAfterMs: 3000 }), () => 0)).toBe(3000);
  const envelopeHint = new ApiError("http", "x", { status: 503, envelope: { request_id: "r", code: "c", message: "m", retryable: true, retry_after_ms: 1200 } });
  expect(retryDelayMs(0, envelopeHint, () => 0)).toBe(1200);
});

test("polling stops on a settled failure and continues through transient ones", () => {
  const poll = pollUnlessSettled(10_000);
  expect(poll({ state: { status: "success", error: null } })).toBe(10_000);
  expect(poll({ state: { status: "error", error: http_(503) } })).toBe(10_000);
  expect(poll({ state: { status: "error", error: http_(404) } })).toBe(false);
  expect(poll({ state: { status: "error", error: http_(422) } })).toBe(false);
});

test("SO-10/RA-15: a 422 read is requested once; a 429 is retried until it succeeds", async () => {
  let invalid = 0, busy = 0;
  server.use(
    http.get("/api/v1/sessions/not-a-uuid", () => { invalid++; return HttpResponse.json({ request_id: "r", code: "invalid_request", message: "bad", retryable: false }, { status: 422 }); }),
    http.get("/api/playbooks/inspection/runs", () => { busy++; return busy < 3 ? HttpResponse.json({ request_id: "r", code: "playbook_capacity_exhausted", message: "busy", retryable: true }, { status: 429, headers: { "Retry-After": "0" } }) : HttpResponse.json({ ok: true }); }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: shouldRetryRead, retryDelay: 1 } } });
  await expect(client.fetchQuery({ queryKey: ["a"], queryFn: () => apiGet("/api/v1/sessions/not-a-uuid") })).rejects.toMatchObject({ status: 422 });
  expect(invalid).toBe(1);
  await expect(client.fetchQuery({ queryKey: ["b"], queryFn: () => apiGet("/api/playbooks/inspection/runs") })).resolves.toEqual({ ok: true });
  expect(busy).toBe(3);
});
