import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { adaptInternalWork, inspectInternalWorkSave, readInternalWorkSettings, saveInternalWorkSettings } from "./internalWork";

const purposes = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"];
const snapshot = () => ({ revision: "3", catalog_revision: "7", default_profile_id: "p1", overrides: { playbook_compilation: "p2" }, purposes });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("adapts a server snapshot, including an unset default", () => {
  expect(adaptInternalWork(snapshot())).toEqual(snapshot());
  expect(adaptInternalWork({ ...snapshot(), default_profile_id: null, overrides: {} }).default_profile_id).toBeNull();
});
test("rejects malformed revisions, unknown purposes and bad profile ids", () => {
  for (const bad of [{ ...snapshot(), revision: "01" }, { ...snapshot(), catalog_revision: 7 }, { ...snapshot(), overrides: { typo: "p" } }, { ...snapshot(), overrides: { playbook_call: "" } }, { ...snapshot(), default_profile_id: 4 }, { ...snapshot(), purposes: ["other"] }])
    expect(() => adaptInternalWork(bad)).toThrow(ContractError);
});
test("reads, saves and inspects a save", async () => {
  let body: Record<string, unknown> | undefined, header: string | null = null;
  server.use(
    http.get("/api/settings/internal-work", () => HttpResponse.json(snapshot())),
    http.post("/api/settings/internal-work", async ({ request }) => { header = request.headers.get("X-AQ-Request"); body = await request.json() as Record<string, unknown>; return HttpResponse.json({ ...snapshot(), revision: "4", operation_id: body.operation_id, disposition: "saved" }); }),
    http.get("/api/settings/internal-work/operations/:id", ({ params }) => HttpResponse.json({ ...snapshot(), operation_id: params.id, disposition: "saved" })),
  );
  expect((await readInternalWorkSettings()).revision).toBe("3");
  const request = { operation_id: "op-1", expected_revision: "3", expected_catalog_revision: "7", default_profile_id: "p1", overrides: {} };
  const saved = await saveInternalWorkSettings(request);
  expect(header).toBe("1");
  expect(body).toEqual(request);
  expect(saved).toMatchObject({ revision: "4", disposition: "saved" });
  expect((await inspectInternalWorkSave("op-1")).operation_id).toBe("op-1");
});
test("rejects a save response for another operation", async () => {
  server.use(http.post("/api/settings/internal-work", () => HttpResponse.json({ ...snapshot(), operation_id: "other", disposition: "saved" })));
  await expect(saveInternalWorkSettings({ operation_id: "op-1", expected_revision: "3", expected_catalog_revision: "7", default_profile_id: null, overrides: {} })).rejects.toThrow(ContractError);
});
