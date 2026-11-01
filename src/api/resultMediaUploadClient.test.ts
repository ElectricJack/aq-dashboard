import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { uploadRequest } from "./resultMediaUploadClient";
import { freezeUpload } from "./adapters/resultMediaUpload";
import { fixtureMediaBinding } from "../test/resultMedia";
import { uploadActor, uploadFile, uploadFixture } from "../test/resultMediaUpload";
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
test("admission uses fixed same-origin CSRF/raw bytes and lookup carries neither JSON nor PNG", async () => {
  const frozen = await freezeUpload(uploadFile(), fixtureMediaBinding(), uploadActor), fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(uploadFixture("reserved", frozen)), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetcher);
  await uploadRequest("create", frozen.operation, new AbortController().signal, frozen);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", body: frozen.raw });
  const options = fetcher.mock.calls[0]![1] as RequestInit; expect(new Headers(options.headers).get("X-AQ-Request")).toBe("1");
  await uploadRequest("lookup", frozen.operation, new AbortController().signal);
  expect(fetcher.mock.calls[1]![1]).not.toHaveProperty("body"); expect(new Headers((fetcher.mock.calls[1]![1] as RequestInit).headers).has("X-AQ-Request")).toBe(false);
});
test("received upload finalization sends only the empty JSON body, without a retained file", async () => {
  const status = uploadFixture("received"), fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(status), { headers: { "Content-Type": "application/json" } })); vi.stubGlobal("fetch", fetcher);
  await uploadRequest("finalize", status.operation_id, new AbortController().signal);
  expect(fetcher.mock.calls[0]![0]).toBe(`/api/human/result-media-uploads/${status.operation_id}/finalize`); expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "POST", body: "{}" });
});
test("bounds status bytes and preserves authorization error identity before parsing", async () => {
  const status = uploadFixture(); vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("x".repeat(262145), { headers: { "Content-Type": "application/json" } })));
  await expect(uploadRequest("lookup", status.operation_id, new AbortController().signal)).rejects.toThrow("exceeds limit");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("not json", { status: 403 })));
  await expect(uploadRequest("lookup", status.operation_id, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
});
test("ordinary finalize conflict remains an unresolved feature response rather than a contract fence", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "conflict", message: "Storage changed" }), { status: 409, headers: { "Content-Type": "application/json" } })));
  await expect(uploadRequest("finalize", uploadFixture().operation_id, new AbortController().signal)).rejects.toMatchObject({ kind: "http", status: 409, effectUnknown: true });
});
