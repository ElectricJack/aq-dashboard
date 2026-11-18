import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { ApiError } from "./client";
import {
  DELIVERY_DOCUMENT_PATH, DELIVERY_LIMITS_PATH, inspectDeliveryDocumentSave, inspectDeliveryLimitsSave, isDeliveryUnavailable, limitFromText, limitToText,
  readDeliveryDocument, readDeliveryLimits, saveDeliveryDocument, saveDeliveryLimits, type DeliveryLimits,
} from "./delivery";

const limits = (): DeliveryLimits => ({ main_sync_interval_ms: 30_000, main_freshness_ms: 120_000, decision_repeat_ms: 60_000, longest_check_wait_ms: 1_800_000, git_transfer_timeout_ms: 300_000, max_push_bytes: 104_857_600 });
const receipt = (revision: string) => ({ revision });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const operation = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;

test("the paths are the delivery routes under /api/settings", () => {
  expect(DELIVERY_DOCUMENT_PATH).toBe("/api/settings/delivery-document");
  expect(DELIVERY_LIMITS_PATH).toBe("/api/settings/delivery-limits");
});
test("reads the document and the limits", async () => {
  server.use(http.get(DELIVERY_DOCUMENT_PATH, () => HttpResponse.json({ markdown: "# Delivery\n", revision: "3" })), http.get(DELIVERY_LIMITS_PATH, () => HttpResponse.json({ limits: limits(), revision: "7" })));
  expect(await readDeliveryDocument()).toEqual({ markdown: "# Delivery\n", revision: "3" });
  expect(await readDeliveryLimits()).toEqual({ limits: limits(), revision: "7" });
});
test("a malformed read is a contract error", async () => {
  for (const bad of [{ markdown: 1, revision: "1" }, { markdown: "", revision: "01" }, null]) {
    server.use(http.get(DELIVERY_DOCUMENT_PATH, () => HttpResponse.json(bad)));
    await expect(readDeliveryDocument()).rejects.toThrow(ContractError);
  }
  const missing: Partial<DeliveryLimits> = limits(); delete missing.max_push_bytes;
  for (const bad of [{ limits: missing, revision: "1" }, { limits: { ...limits(), max_push_bytes: "100" }, revision: "1" }, { limits: { ...limits(), main_freshness_ms: 1.5 }, revision: "1" }, { limits: limits() }]) {
    server.use(http.get(DELIVERY_LIMITS_PATH, () => HttpResponse.json(bad)));
    await expect(readDeliveryLimits()).rejects.toThrow(ContractError);
  }
});
test("a server without delivery answers 404, which is the unavailable case", async () => {
  server.use(http.get(DELIVERY_DOCUMENT_PATH, () => HttpResponse.json({ error: "not_found", message: "no" }, { status: 404 })));
  const failure = await readDeliveryDocument().catch((error: unknown) => error);
  expect(isDeliveryUnavailable(failure)).toBe(true);
  expect(isDeliveryUnavailable(new ApiError("http", "x", { status: 500 }))).toBe(false);
  expect(isDeliveryUnavailable(new Error("x"))).toBe(false);
});
test("a document save is one PUT of the text, the revision it read and its operation id", async () => {
  const requests: { method: string; body: unknown }[] = [];
  server.use(http.all(DELIVERY_DOCUMENT_PATH, async ({ request }) => { requests.push({ method: request.method, body: await request.json() }); return HttpResponse.json(receipt("4")); }));
  expect(await saveDeliveryDocument({ markdown: "# New\n", expected_revision: "3", operation_id: operation(1) })).toBe("4");
  expect(requests).toEqual([{ method: "PUT", body: { markdown: "# New\n", expected_revision: "3", operation_id: operation(1) } }]);
});
test("a limits save is one PUT of the limits, the revision it read and its operation id", async () => {
  const requests: { method: string; body: unknown }[] = [];
  server.use(http.all(DELIVERY_LIMITS_PATH, async ({ request }) => { requests.push({ method: request.method, body: await request.json() }); return HttpResponse.json(receipt("8")); }));
  expect(await saveDeliveryLimits({ limits: limits(), expected_revision: "7", operation_id: operation(2) })).toBe("8");
  expect(requests).toEqual([{ method: "PUT", body: { limits: limits(), expected_revision: "7", operation_id: operation(2) } }]);
});
test("a stale save is a 409 and ends that save; a receipt without a revision is a contract error", async () => {
  server.use(http.put(DELIVERY_LIMITS_PATH, () => HttpResponse.json({ error: "conflict", message: "moved" }, { status: 409 })));
  const failure = await saveDeliveryLimits({ limits: limits(), expected_revision: "1", operation_id: operation(3) }).catch((error: unknown) => error);
  expect((failure as ApiError).status).toBe(409);
  await expect(inspectDeliveryLimitsSave(operation(3))).rejects.toMatchObject({ status: 404 });
  server.use(http.put(DELIVERY_DOCUMENT_PATH, () => HttpResponse.json({ digest: "x" })));
  await expect(saveDeliveryDocument({ markdown: "x", expected_revision: "1", operation_id: operation(4) })).rejects.toThrow(ContractError);
});
test("checking a save whose answer was lost sends the same bytes again", async () => {
  const bodies: string[] = []; let fail = true;
  server.use(http.put(DELIVERY_DOCUMENT_PATH, async ({ request }) => { bodies.push(await request.text()); return fail ? HttpResponse.error() : HttpResponse.json(receipt("5")); }));
  const request = { markdown: "# Kept\n", expected_revision: "4", operation_id: operation(5) };
  await expect(saveDeliveryDocument(request)).rejects.toBeInstanceOf(ApiError);
  fail = false;
  expect(await inspectDeliveryDocumentSave(operation(5))).toBe("5");
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  await expect(inspectDeliveryDocumentSave(operation(5))).rejects.toMatchObject({ status: 404 });
});
test("limits are shown in seconds, minutes and MB, and typed values convert back exactly", () => {
  expect(limitToText(30_000, "seconds")).toBe("30");
  expect(limitToText(1_500, "seconds")).toBe("1.5");
  expect(limitToText(1_800_000, "minutes")).toBe("30");
  expect(limitToText(104_857_600, "MB")).toBe("100");
  expect(limitFromText(" 30 ", "seconds")).toEqual({ value: 30_000 });
  expect(limitFromText("1.1", "seconds")).toEqual({ value: 1_100 });
  expect(limitFromText("0.5", "minutes")).toEqual({ value: 30_000 });
  expect(limitFromText("2", "MB")).toEqual({ value: 2_097_152 });
});
test("a limit that is not a positive whole number of milliseconds or bytes is refused with a reason", () => {
  for (const text of ["", "abc", "-1", "1e3", "0x10", "1,5"]) expect(limitFromText(text, "seconds")).toEqual({ problem: "Enter a number, such as 30." });
  expect(limitFromText("0", "seconds")).toEqual({ problem: "Must be more than zero." });
  expect(limitFromText("0.0005", "seconds")).toMatchObject({ problem: expect.stringContaining("milliseconds") });
  expect(limitFromText("0.0000001", "MB")).toMatchObject({ problem: expect.stringContaining("bytes") });
  expect(limitFromText("9".repeat(20), "MB")).toEqual({ problem: "That is too large." });
});
