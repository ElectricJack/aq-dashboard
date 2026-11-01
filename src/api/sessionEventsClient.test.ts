import { vi } from "vitest";
import { sessionEventsJson } from "./sessionEventsClient";
afterEach(() => vi.unstubAllGlobals());
function serve(body: string, status = 200, type = "application/json") { const fetcher = vi.fn().mockResolvedValue(new Response(body, { status, headers: { "content-type": type } })); vi.stubGlobal("fetch", fetcher); return fetcher; }
test("only finite same-origin GET with pinned cursor and explicit bounds", async () => {
  const fetcher = serve('{"ok":true}');
  await expect(sessionEventsJson("attempt", { after: 2, through: 7 }, new AbortController().signal)).resolves.toEqual({ ok: true });
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("/api/observations/sessions/attempt/events?after_sequence=2&limit=16&through_sequence=7");
  expect(options).toMatchObject({ method: "GET", mode: "same-origin", credentials: "same-origin", redirect: "error", cache: "no-store" });
});
test.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":2.0}', '{"x":2e0}', '{"x":9007199254740993}', '{"x":-0}', '{"x":'])('refuses duplicate/lossy or invalid JSON %s', async body => {
  serve(body);
  await expect(sessionEventsJson("attempt", { after: 0 }, new AbortController().signal)).rejects.toMatchObject({ kind: "contract" });
});
test("byte bound and wrong MIME refuse before use; HTTP errors retain status", async () => {
  serve('"' + "a".repeat(262144) + '"'); await expect(sessionEventsJson("attempt", { after: 0 }, new AbortController().signal)).rejects.toMatchObject({ kind: "contract" });
  serve("{}", 200, "text/html"); await expect(sessionEventsJson("attempt", { after: 0 }, new AbortController().signal)).rejects.toMatchObject({ kind: "contract" });
  serve("{}", 403); await expect(sessionEventsJson("attempt", { after: 0 }, new AbortController().signal)).rejects.toMatchObject({ kind: "http", status: 403 });
});
