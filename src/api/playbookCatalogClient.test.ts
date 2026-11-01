import { vi } from "vitest";
import { playbookCatalogJson } from "./playbookCatalogClient";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function serve(body: BodyInit | null, status = 200, type = "application/json") { const fetcher = vi.fn().mockResolvedValue(new Response(body, { status, headers: { "content-type": type } })); vi.stubGlobal("fetch", fetcher); return fetcher; }
const read = (signal = new AbortController().signal) => playbookCatalogJson("definitions", null, {}, signal);
test("finite same-origin no-store GET pins kind and request cursor", async () => {
  const fetcher = serve('{"ok":true}'); await expect(read()).resolves.toEqual({ ok: true });
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/playbooks/inspection/catalog/definitions?limit=25");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store" });
});
test.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":1.0}', '{"x":1e0}', '{"x":-0}', '{"x":-1}', '{"x":9007199254740993}', '{"x":'])('refuses duplicate, lossy or malformed document %s', async body => { serve(body); await expect(read()).rejects.toMatchObject({ kind: "contract" }); });
test.each([401, 403])("classifies %i headers before a held body or pending cancellation", async status => {
  let cancelled = false;
  serve(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => undefined); } }), status);
  await expect(read()).rejects.toMatchObject({ kind: "http", status }); expect(cancelled).toBe(true);
});
test("oversize streaming body refuses before EOF and never awaits cancellation", async () => {
  let cancelled = false;
  serve(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(262145)); }, cancel() { cancelled = true; return new Promise(() => undefined); } }));
  await expect(read()).rejects.toMatchObject({ kind: "contract" }); expect(cancelled).toBe(true);
});
test("fatal UTF8 and exact JSON MIME are required", async () => {
  serve(new Uint8Array([0xff]).buffer); await expect(read()).rejects.toMatchObject({ kind: "contract" });
  serve("{}", 200, "application/json-not-really"); await expect(read()).rejects.toMatchObject({ kind: "contract" });
});
test.each(["request", "body"])("finite deadline bounds an uncooperative %s promise", async phase => {
  vi.useFakeTimers(); let requestSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((_path, options: RequestInit) => { requestSignal = options.signal as AbortSignal; return phase === "request" ? new Promise(() => undefined) : Promise.resolve(new Response(new ReadableStream({ cancel() { return new Promise(() => undefined); } }), { headers: { "content-type": "application/json" } })); }));
  const outcome = read().catch((error: unknown) => error); await vi.advanceTimersByTimeAsync(5000);
  expect(await outcome).toMatchObject({ name: "TimeoutError" }); expect(requestSignal?.aborted).toBe(true);
});
test("caller abort ends a stalled body without waiting for cancellation", async () => {
  serve(new ReadableStream({ cancel() { return new Promise(() => undefined); } }));
  const controller = new AbortController(), outcome = read(controller.signal).catch((error: unknown) => error); await Promise.resolve(); await Promise.resolve(); controller.abort();
  expect(await outcome).toMatchObject({ name: "AbortError" });
});
