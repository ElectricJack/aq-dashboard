import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { sessionUsageJson } from "./sessionUsageClient";
import { usageFixture } from "../test/sessionUsage";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const read = () => sessionUsageJson("attempt", new AbortController().signal);
test("uses only a finite same-origin read and preserves the usage wire", async () => {
  server.use(http.get("/api/observations/sessions/attempt/usage", ({ request }) => {
    expect(request.headers.get("Accept")).toBe("application/json");
    expect(request.credentials).toBe("same-origin");
    return HttpResponse.json(usageFixture());
  }));
  expect(await read()).toEqual(usageFixture());
});
test.each([401, 403, 404, 503])("retains HTTP %s for the normal authorization/feature error policy", async status => {
  server.use(http.get("/api/observations/sessions/attempt/usage", () => new HttpResponse(null, { status })));
  await expect(read()).rejects.toMatchObject({ kind: "http", status });
});
test("rejects oversized and non-JSON responses", async () => {
  server.use(http.get("/api/observations/sessions/attempt/usage", () => new HttpResponse(" ".repeat(16385), { headers: { "content-type": "application/json" } })));
  await expect(read()).rejects.toMatchObject({ kind: "contract" });
  server.use(http.get("/api/observations/sessions/attempt/usage", () => HttpResponse.html("<h1>Sign in</h1>")));
  await expect(read()).rejects.toMatchObject({ kind: "contract" });
});
