import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { adaptRoutingPolicy, readRoutingPolicy, ROUTING_POLICY_PATH, setRouting } from "./routing";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const source = { id: "routing", kind: "builtin", binding: "aq.routing", purpose: "Choose the intelligence level for each task", revision: 1, active: null, latest: null };
const sourcePath = "/api/playbooks/sources/routing";

test("the routing read is the switch and the routing source, which may be null or not sent yet", () => {
  expect(adaptRoutingPolicy({ enabled: true, source })).toEqual({ enabled: true, source });
  expect(adaptRoutingPolicy({ enabled: false, source: null })).toEqual({ enabled: false, source: null });
  expect(adaptRoutingPolicy({ enabled: false, active: null, latest: null })).toEqual({ enabled: false, source: null });
  expect(() => adaptRoutingPolicy({ enabled: "yes" })).toThrow("Contract violation");
  expect(() => adaptRoutingPolicy({ enabled: true, source: { id: 3 } })).toThrow("Contract violation");
});

test("a source in the routing read is used as it is, without a second read", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: true, source })));
  expect(await readRoutingPolicy()).toEqual({ enabled: true, source, gap: null });
});

test("without a source in the routing read, the source is read from the sources API", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, source: null })), http.get(sourcePath, () => HttpResponse.json(source)));
  expect(await readRoutingPolicy()).toEqual({ enabled: false, source, gap: null });
});

test("a routing source that does not exist yet, and playbooks that are not running, are states and not errors", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, source: null })),
    http.get(sourcePath, () => HttpResponse.json({ error: "not_found", message: "There is no playbook source routing" }, { status: 404 })));
  expect(await readRoutingPolicy()).toEqual({ enabled: false, source: null, gap: "missing" });
  server.use(http.get(sourcePath, () => HttpResponse.json({ error: "playbooks_unavailable", message: "playbooks unavailable: engine database timeout" }, { status: 503 })));
  expect(await readRoutingPolicy()).toEqual({ enabled: false, source: null, gap: "unavailable" });
});

test("any other failure reading the source is an error", async () => {
  server.use(http.get(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: false, source: null })),
    http.get(sourcePath, () => HttpResponse.json({ error: "boom", message: "x" }, { status: 500 })));
  await expect(readRoutingPolicy()).rejects.toThrow();
});

test("turning routing on posts the switch and keeps the server's refusal words", async () => {
  let posted: unknown;
  server.use(http.post(ROUTING_POLICY_PATH, async ({ request }) => { posted = await request.json(); return HttpResponse.json({ error: "conflict", message: "Routing can be turned on once a routing playbook is active" }, { status: 409 }); }));
  await expect(setRouting(true)).rejects.toMatchObject({ serverMessage: "Routing can be turned on once a routing playbook is active" });
  expect(posted).toEqual({ enabled: true });
  server.use(http.post(ROUTING_POLICY_PATH, () => HttpResponse.json({ enabled: true, source })));
  expect(await setRouting(true)).toBe(true);
});
