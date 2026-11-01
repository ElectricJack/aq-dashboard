import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { resultMediaBytes, resultMediaJson, resultMediaPath } from "./resultMediaClient";
import { fixtureArtifact, fixtureHash, fixtureMediaBinding, fixtureMediaHeaders, fixturePng } from "../test/resultMedia";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); }); afterAll(() => server.close());
const binding = fixtureMediaBinding(), path = `${resultMediaPath(binding)}/${fixtureArtifact().receipt.artifact_id}/content`;
const read = () => resultMediaBytes(binding, fixtureArtifact(), "preview", new AbortController().signal);
const png = (bytes = fixturePng(), headers = fixtureMediaHeaders()) => new HttpResponse(Uint8Array.from(bytes).buffer, { headers });
test("only exact selected artifact/variant bytes and receipt digest pass", async () => {
  server.use(http.get(path, ({ request }) => { expect(new URL(request.url).searchParams.get("variant")).toBe("preview"); expect(request.headers.has("Range")).toBe(false); return png(); }));
  expect(await read()).toEqual(fixturePng());
});
test.each(["Content-Type", "Content-Length", "AQ-Media-Digest", "AQ-Media-Receipt-Digest"])("rejects wrong %s before any renderable data", async header => {
  server.use(http.get(path, () => png(fixturePng(), { ...fixtureMediaHeaders(), [header]: header === "Content-Length" ? String(fixturePng().length + 1) : "wrong" })));
  await expect(read()).rejects.toHaveProperty("name", "ContractError");
});
test("rejects truncated/extra/corrupt bytes despite matching declared headers", async () => {
  const corrupted = fixturePng(); corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
  // A finite response stream isolates EOF/length validation from a transport that
  // may wait for its promised Content-Length until the separate request timeout.
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const bytes of [fixturePng().slice(0, -1), Uint8Array.from([...fixturePng(), 0]), corrupted]) {
    fetch.mockResolvedValueOnce(new Response(Uint8Array.from(bytes).buffer, { headers: fixtureMediaHeaders() }));
    await expect(read()).rejects.toHaveProperty("name", "ContractError");
  }
});
test("a matching byte digest cannot bypass pinned PNG dimensions or RGBA8 policy", async () => {
  const bytes = fixturePng(), artifact = fixtureArtifact(); bytes[19] = 3;
  artifact.receipt.variants.preview.digest = fixtureHash(bytes);
  server.use(http.get(path, () => png(bytes, fixtureMediaHeaders(artifact))));
  await expect(resultMediaBytes(binding, artifact, "preview", new AbortController().signal)).rejects.toHaveProperty("name", "ContractError");
});
test.each([401, 403])("preserves %s for the global authorization fence", async status => {
  server.use(http.get(path, () => new HttpResponse(null, { status })));
  await expect(read()).rejects.toMatchObject({ status });
});
test("typed content failure stays specific; generic404 remains a neutral scoped error", async () => {
  server.use(http.get(path, () => HttpResponse.json({ contract: "human-result-media-1", error: "media_expired", message: "Image expired" }, { status: 410 })));
  await expect(read()).rejects.toMatchObject({ name: "MediaUnavailableError", code: "media_expired" });
  server.use(http.get(path, () => HttpResponse.json({ error: "not_found", message: "Not available" }, { status: 404 })));
  await expect(read()).rejects.toMatchObject({ name: "ApiError", status: 404 });
});
test("listing is bounded and non-JSON positive responses retain the contract fence", async () => {
  server.use(http.get(resultMediaPath(binding), () => HttpResponse.html("Sign in")));
  await expect(resultMediaJson(binding, new AbortController().signal)).rejects.toHaveProperty("name", "ContractError");
  server.use(http.get(resultMediaPath(binding), () => new HttpResponse(" ".repeat(262145), { headers: { "Content-Type": "application/json" } })));
  await expect(resultMediaJson(binding, new AbortController().signal)).rejects.toHaveProperty("name", "ContractError");
});
