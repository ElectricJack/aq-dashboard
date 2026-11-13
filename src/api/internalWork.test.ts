import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ContractError } from "./adapters/contract";
import { adaptInternalRun, adaptInternalWork, inspectInternalWorkSave, listInternalRuns, readInternalRun, readInternalWorkSettings, retryInternalRun, saveInternalWorkSettings } from "./internalWork";

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

const run = () => ({ id: "00000000-0000-4000-8000-0000000000a1", purpose: "playbook_call", status: "answered", affected: { kind: "task", id: "T-1", project_id: null }, instructions: "i", input: "x", answer: { a: 1 },
  attempts: [{ provider: "p", model: "m", way: "api", reason: null, detail: "", elapsed_ms: 5 }], provider: "p", model: "m", way: "api", elapsed_ms: 5, usage: { input_tokens: 1, output_tokens: 2 }, created_at_ms: 1, finished_at_ms: 6, escalation: "none" });
test("adapts a run, keeping absent optional fields absent and dropping unknown ones", () => {
  expect(adaptInternalRun({ ...run(), extra: "x" })).toEqual(run());
  const failed = adaptInternalRun({ id: run().id, purpose: "playbook_call", status: "failed", affected: run().affected, instructions: "", input: "", attempts: [], reason: "no_candidate", detail: "d", created_at_ms: 1, escalation: "owner", retry_of: run().id });
  expect(failed).toEqual({ id: run().id, purpose: "playbook_call", status: "failed", affected: run().affected, instructions: "", input: "", attempts: [], reason: "no_candidate", detail: "d", created_at_ms: 1, escalation: "owner", retry_of: run().id });
});
test("rejects a malformed run", () => {
  for (const bad of [{ ...run(), id: "nope" }, { ...run(), purpose: "typo" }, { ...run(), status: "done" }, { ...run(), affected: { kind: "task", id: 1, project_id: null } }, { ...run(), attempts: [{ provider: "p" }] }, { ...run(), elapsed_ms: -1 }, { ...run(), escalation: "x" }, { ...run(), usage: { input_tokens: "1", output_tokens: 2 } }])
    expect(() => adaptInternalRun(bad)).toThrow(ContractError);
});
test("lists, reads and retries runs", async () => {
  let search = "", header: string | null = null;
  server.use(
    http.get("/api/internal-work/runs", ({ request }) => { search = new URL(request.url).search; return HttpResponse.json({ runs: [run()], next_cursor: "1:abc" }); }),
    http.get("/api/internal-work/runs/:id", () => HttpResponse.json(run())),
    http.post("/api/internal-work/runs/:id/retry", ({ request }) => { header = request.headers.get("X-AQ-Request"); return HttpResponse.json({ id: "00000000-0000-4000-8000-0000000000b1" }); }),
  );
  const page = await listInternalRuns({ affected_kind: "task", purpose: "playbook_call", status: "failed", limit: 5, cursor: undefined });
  expect(search).toBe("?affected_kind=task&purpose=playbook_call&status=failed&limit=5");
  expect(page).toEqual({ runs: [run()], next_cursor: "1:abc" });
  expect((await readInternalRun(run().id)).id).toBe(run().id);
  expect(await retryInternalRun(run().id)).toEqual({ id: "00000000-0000-4000-8000-0000000000b1" });
  expect(header).toBe("1");
});
test("rejects a malformed run page and a malformed retry response", async () => {
  server.use(http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [{ id: 1 }], next_cursor: null })), http.post("/api/internal-work/runs/:id/retry", () => HttpResponse.json({ id: "x" })));
  await expect(listInternalRuns({})).rejects.toThrow(ContractError);
  await expect(retryInternalRun(run().id)).rejects.toThrow(ContractError);
});
