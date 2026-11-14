import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { adaptRoutingSwitch, readRoutingPolicy, ROUTING_POLICY_PATH, setRouting } from "./routing";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const source = { id: "routing", kind: "builtin", binding: "aq.routing", active: null, latest: null };

test("reads only the switch from the routing endpoint, whatever else it still carries", () => {
  expect(adaptRoutingSwitch({ enabled: true, active: null, latest: null })).toBe(true);
  expect(adaptRoutingSwitch({ enabled: false })).toBe(false);
  expect(() => adaptRoutingSwitch({ enabled: "yes" })).toThrow("Contract violation");
});

test("combines the switch with the routing source", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, active: null, latest: null })), http.get("/api/playbooks/sources/routing", () => HttpResponse.json(source)));
  expect(await readRoutingPolicy()).toEqual({ enabled: false, source: { ...source, active: null, latest: null } });
});

test("a routing source that does not exist yet reads as no playbook, not as an error", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, active: null, latest: null })),
    http.get("/api/playbooks/sources/routing", () => HttpResponse.json({ error: "not_found", message: "Source not found" }, { status: 404 })));
  expect(await readRoutingPolicy()).toMatchObject({ enabled: false, source: { id: "routing", active: null, latest: null } });
});

test("any other failure reading the source is an error", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, active: null, latest: null })),
    http.get("/api/playbooks/sources/routing", () => HttpResponse.json({ error: "boom", message: "x" }, { status: 500 })));
  await expect(readRoutingPolicy()).rejects.toThrow();
});

test("turning routing on posts the switch and keeps the server's refusal words", async () => {
  let posted: unknown;
  server.use(http.post(ROUTING_POLICY_PATH, async ({ request }) => { posted = await request.json(); return HttpResponse.json({ error: "conflict", message: "Routing can be turned on once a routing playbook is active" }, { status: 409 }); }));
  await expect(setRouting(true)).rejects.toMatchObject({ serverMessage: "Routing can be turned on once a routing playbook is active" });
  expect(posted).toEqual({ enabled: true });
});
