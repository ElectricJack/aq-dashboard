import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { terminalJson } from "./terminalClient";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const signal = () => new AbortController().signal;
test("requires explicit server anchor and JSON", async () => {
  server.use(http.get("/tail-client", () => HttpResponse.json({ bytes: [] })));
  await expect(terminalJson("/tail-client", signal())).rejects.toThrow("clock anchor");
  server.use(http.get("/tail-client", () => HttpResponse.text("not JSON", { headers: { "aq-terminal-server-time-ms": "10000" } })));
  await expect(terminalJson("/tail-client", signal())).rejects.toThrow("Invalid terminal response");
});
test("bounds wire bytes and rejects malformed UTF8/JSON", async () => {
  server.use(http.get("/tail-client", () => HttpResponse.json({ text: "x".repeat(524288) }, { headers: { "aq-terminal-server-time-ms": "10000" } })));
  await expect(terminalJson("/tail-client", signal())).rejects.toThrow("byte bound");
  server.use(http.get("/tail-client", () => new HttpResponse(new Uint8Array([0xff]), { headers: { "content-type": "application/json", "aq-terminal-server-time-ms": "10000" } })));
  await expect(terminalJson("/tail-client", signal())).rejects.toThrow("Invalid terminal JSON");
});
test("Watch mutation has no automatic retry on503", async () => {
  let calls = 0;
  server.use(http.post("/tail-client", () => { calls++; return HttpResponse.json({}, { status: 503 }); }));
  await expect(terminalJson("/tail-client", signal(), { kind: "watch" })).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(1);
});
