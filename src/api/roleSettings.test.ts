import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { roleSettingsHandlers } from "../mocks/roleSettings";
import { ContractError } from "./adapters/contract";
import { adaptDocument, adaptDocumentList, adaptModelSuggestions, adaptProfileLimits, adaptSelectionDefaults, deleteDocument, problemsOf, problemText, readDocument, readDocuments, readModelSuggestions, readProfileLimits, readProfileSnapshot, readSelectionDefaults, saveDocument, saveProfileLimits, saveSelectionDefaults } from "./roleSettings";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => server.use(...roleSettingsHandlers()));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const operation = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Documents as aq-server's `aq-role-settings` answers them (its `http.rs` and `it_access/role_settings.rs`). */
const role = { kind: "role", id: "developer", revision: "1", updated_at_ms: 1_000_000, markdown: "---\nid: developer\n---\n## Role\nText\n", problem: null,
  fields: { id: "developer", name: "Developer", description: "Makes the change.", execution: "sandbox", operations: ["task.read", "knowledge.read", "source.write"], enabled: true, role_md: "Text", rules_md: "" } };
const level = { kind: "intelligence", id: "standard-high", revision: "1", updated_at_ms: 1, markdown: "x", problem: null,
  fields: { id: "standard-high", name: "Standard, high", description: "", candidates: [{ provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "high", harnesses: ["claude"] }] } };
const sandbox = { kind: "execution", id: "sandbox", revision: "1", updated_at_ms: 1, markdown: "x", problem: null,
  fields: { id: "sandbox", name: "Sandbox", description: "", harnesses: ["claude"], environment: "env", confinement: "container", credentials: { claude: "owner" },
    limits: { wall_time_ms: 900000, memory_bytes: 4294967296, cpu_millis: 2000, process_limit: 512, startup_context_bytes: 65536, max_output_tokens: 32000 } } };

test("adapts each kind of document as the server sends it", () => {
  expect(adaptDocument("role", role)).toEqual(role);
  expect(adaptDocument("intelligence", level)).toEqual({ ...level, fields: { ...level.fields, selection: {} } });
  expect(adaptDocument("intelligence", { ...level, fields: { ...level.fields, selection: { max_attempts: 3, fallback_on: ["unavailable"], max_cost_microunits: null } } }).fields?.selection)
    .toEqual({ max_attempts: 3, fallback_on: ["unavailable"], max_cost_microunits: null });
  expect(adaptDocument("execution", sandbox)).toEqual(sandbox);
  expect(adaptDocumentList("role", { revision: "4", active_digest: "a".repeat(64), documents: [role] })).toEqual({ revision: "4", active_digest: "a".repeat(64), documents: [role] });
  expect(adaptDocumentList("role", { revision: "0", active_digest: null, documents: [] }).active_digest).toBeNull();
});
test("a stored document that does not parse keeps its text and the server's reason", () => {
  const unreadable = { ...role, markdown: "not a document", fields: null, problem: "line 1: a document starts with a `---` line" };
  expect(adaptDocument("role", unreadable)).toEqual(unreadable);
});
test("refuses responses that are not what the routes promise", () => {
  for (const bad of [
    { ...role, kind: "execution" }, { ...role, revision: 1 }, { ...role, revision: "01" }, { ...role, markdown: undefined }, { ...role, fields: null }, { ...role, problem: "both" },
    { ...role, fields: { ...role.fields, operations: "task.read" } }, { ...role, fields: { ...role.fields, enabled: "true" } },
  ]) expect(() => adaptDocument("role", bad)).toThrow(ContractError);
  expect(() => adaptDocument("intelligence", { ...level, fields: { ...level.fields, candidates: [{ provider: "anthropic" }] } })).toThrow(ContractError);
  expect(() => adaptDocument("execution", { ...sandbox, fields: { ...sandbox.fields, limits: { wall_time_ms: 1 } } })).toThrow(ContractError);
  expect(() => adaptDocumentList("role", { revision: "1", active_digest: "short", documents: [] })).toThrow(ContractError);
  expect(() => adaptDocumentList("role", { revision: "1", active_digest: null, documents: [role, role] })).toThrow(ContractError);
  expect(() => adaptSelectionDefaults({ revision: "0", selection_defaults: { max_attempts: 2 } })).toThrow(ContractError);
  expect(() => adaptProfileLimits({ revision: "0", limits: { snapshots_kept: 20 } })).toThrow(ContractError);
});

test("reads the lists, one document, and a missing one as 404", async () => {
  const roles = await readDocuments("role");
  expect(roles.documents.map(d => d.id)).toEqual(["developer", "reviewer"]);
  expect(roles.documents[0]!.fields).toMatchObject({ execution: "fixture-sandbox", operations: ["task.read", "knowledge.read", "source.write"], enabled: true });
  expect((await readDocuments("intelligence")).documents[1]!.fields?.candidates[0]).toEqual({ provider: "fixture-provider", model: "fixture-model", reasoning: "low", harnesses: ["opencode"] });
  expect((await readDocument("execution", "fixture-sandbox")).fields?.limits.wall_time_ms).toBe(900000);
  await expect(readDocument("role", "tester")).rejects.toMatchObject({ status: 404 });
  expect(await readProfileSnapshot()).toEqual({ revision: roles.revision, active_digest: roles.active_digest });
});
test("a save sends the Markdown with the request header, and the receipt moves the snapshot; the same operation replays", async () => {
  const requests: Request[] = [];
  server.events.on("request:start", ({ request }) => { if (request.method !== "GET") requests.push(request.clone()); });
  const before = await readDocument("role", "developer");
  const markdown = `${before.markdown}- Fixture: ask before deleting files.\n`;
  const request = { markdown, expected_revision: before.revision, operation_id: operation(1) };
  const receipt = await saveDocument("role", "developer", request);
  expect(receipt.revision).toBe("2");
  expect(await saveDocument("role", "developer", request)).toEqual(receipt);
  expect(requests[0]!.method).toBe("PUT"); expect(new URL(requests[0]!.url).pathname).toBe("/api/settings/roles/developer"); expect(requests[0]!.headers.get("X-AQ-Request")).toBe("1");
  expect(await requests[0]!.json()).toEqual(request);
  const after = await readDocument("role", "developer");
  expect([after.markdown, after.revision, after.fields?.rules_md.endsWith("ask before deleting files.")]).toEqual([markdown, "2", true]);
  expect(await readProfileSnapshot()).toEqual({ revision: "2", active_digest: receipt.digest });
  server.events.removeAllListeners();
});
test("a stale revision is 409, and an invalid document is 400 with every problem", async () => {
  const before = await readDocument("role", "developer");
  await expect(saveDocument("role", "developer", { markdown: before.markdown, expected_revision: "0", operation_id: operation(2) })).rejects.toMatchObject({ status: 409 });
  const broken = before.markdown.replace("execution: fixture-sandbox", "execution: nowhere").replace("task.read", "task.fly");
  const refused = await saveDocument("role", "developer", { markdown: broken, expected_revision: before.revision, operation_id: operation(3) }).catch(error => error as unknown);
  expect(refused).toMatchObject({ status: 400 });
  expect(problemsOf(refused)).toEqual([
    { document: "role `developer`", field: "execution", message: "no execution profile `nowhere` exists" },
    { document: "role `developer`", field: "operations", message: "`task.fly` is not an AQ operation a role can hold" },
  ]);
  expect(problemsOf(refused).map(problemText)).toEqual(["role `developer`: execution: no execution profile `nowhere` exists", "role `developer`: operations: `task.fly` is not an AQ operation a role can hold"]);
  const unreadable = await saveDocument("role", "developer", { markdown: "not a document", expected_revision: before.revision, operation_id: operation(4) }).catch(error => error as unknown);
  expect(problemsOf(unreadable).map(problemText)).toEqual(["role document `developer`: line 1: a document starts with a `---` line"]);
  expect(problemsOf(new Error("other"))).toEqual([]);
  expect((await readDocument("role", "developer")).markdown).toBe(before.markdown);
});
test("delete names the revision and operation in the query; a referenced document is refused with the problems", async () => {
  let query = "";
  server.events.on("request:start", ({ request }) => { if (request.method === "DELETE") query = new URL(request.url).search; });
  const refused = await deleteDocument("execution", "fixture-sandbox", { expected_revision: "1", operation_id: operation(5) }).catch(error => error as unknown);
  expect(query).toBe(`?expected_revision=1&operation_id=${operation(5)}`);
  expect(problemsOf(refused).map(problemText)).toEqual(["role `developer`: execution: no execution profile `fixture-sandbox` exists", "role `reviewer`: execution: no execution profile `fixture-sandbox` exists"]);
  const receipt = await deleteDocument("intelligence", "standard-low", { expected_revision: "1", operation_id: operation(6) });
  expect(receipt.revision).toBe("2");
  await expect(readDocument("intelligence", "standard-low")).rejects.toMatchObject({ status: 404 });
  await expect(deleteDocument("intelligence", "standard-low", { expected_revision: "1", operation_id: operation(7) })).rejects.toMatchObject({ status: 404 });
  server.events.removeAllListeners();
});
test("selection defaults and limits are read and replaced at their own revisions", async () => {
  const defaults = await readSelectionDefaults();
  expect(defaults).toMatchObject({ revision: "0", selection_defaults: { max_attempts: 2, unknown_cost: "allow_bounded", max_cost_microunits: null, currency: null } });
  const saved = await saveSelectionDefaults({ selection_defaults: { ...defaults.selection_defaults, max_attempts: 3 }, expected_revision: "0", operation_id: operation(8) });
  expect(await readSelectionDefaults()).toMatchObject({ revision: saved.revision, selection_defaults: { max_attempts: 3 } });
  await expect(saveSelectionDefaults({ selection_defaults: defaults.selection_defaults, expected_revision: "0", operation_id: operation(9) })).rejects.toMatchObject({ status: 409 });
  const limits = await readProfileLimits();
  expect(limits.limits).toEqual({ documents: { max_document_bytes: 65536, max_set_bytes: 1048576, max_documents_per_kind: 128, max_name_bytes: 128, max_description_bytes: 2000 }, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 });
  await saveProfileLimits({ limits: { ...limits.limits, snapshots_kept: 5 }, expected_revision: limits.revision, operation_id: operation(10) });
  expect((await readProfileLimits()).limits.snapshots_kept).toBe(5);
});
test("a server error body without problems is not mistaken for them", async () => {
  server.use(http.put("/api/settings/roles/:id", () => HttpResponse.json({ error: "bad_request", message: "Invalid settings request" }, { status: 400 })));
  const refused = await saveDocument("role", "developer", { markdown: "x", expected_revision: "1", operation_id: operation(11) }).catch(error => error as unknown);
  expect(refused).toMatchObject({ status: 400, serverMessage: "Invalid settings request" });
  expect(problemsOf(refused)).toEqual([]);
});

test("the limits carry refusals_kept when the server has it, and a save sends it back", async () => {
  // aq-server 09ee5e98 `aq-role-settings/src/lib.rs` `StoreLimits`: a PUT without the key would reset it to the default.
  const documents = { max_document_bytes: 1, max_set_bytes: 2, max_documents_per_kind: 3, max_name_bytes: 4, max_description_bytes: 5 };
  expect(adaptProfileLimits({ revision: "2", limits: { documents, snapshots_kept: 20, operations_kept: 200, refusals_kept: 1000 } }).limits.refusals_kept).toBe(1000);
  expect(adaptProfileLimits({ revision: "2", limits: { documents, snapshots_kept: 20, operations_kept: 200 } }).limits).not.toHaveProperty("refusals_kept");
  expect(() => adaptProfileLimits({ revision: "2", limits: { documents, snapshots_kept: 20, operations_kept: 200, refusals_kept: "many" } })).toThrow(ContractError);
  const read = await readProfileLimits();
  expect(read.limits.refusals_kept).toBe(1000);
  let body: unknown;
  server.use(http.put("/api/settings/profiles/limits", async ({ request }) => { body = await request.json(); return HttpResponse.json({ revision: "9", digest: "a".repeat(64) }); }));
  await saveProfileLimits({ limits: { ...read.limits, refusals_kept: 50 }, expected_revision: read.revision, operation_id: operation(77) });
  expect(body).toMatchObject({ limits: { refusals_kept: 50, snapshots_kept: 20 } });
});
test("model suggestions are read by harness as the server answers them, and nothing in them is an error", async () => {
  // aq-server 09ee5e98 `it_access/role_settings.rs` `model_suggestions_are_read_from_the_discovery_cache_and_never_fail`.
  const answer = { harnesses: [
    { harness: "claude", models: [{ provider: "anthropic", model: "claude-y", source: null, observed_at: null }] },
    { harness: "codex", models: [{ provider: "openai", model: "gpt-x", source: "Codex CLI", observed_at: "2026-11-16T00:00:00Z" }] },
  ] };
  expect(adaptModelSuggestions(answer)).toEqual({ claude: answer.harnesses[0]!.models, codex: answer.harnesses[1]!.models });
  expect(adaptModelSuggestions({ harnesses: [] })).toEqual({});
  expect(adaptModelSuggestions(null)).toEqual({});
  expect(adaptModelSuggestions({ harnesses: [{ harness: "codex", models: [{ provider: "openai", model: "gpt-x" }, { provider: "openai", model: "gpt-x", extra: 1 }, { model: 7 }, "x"] }, { harness: 3 }] }))
    .toEqual({ codex: [{ provider: "openai", model: "gpt-x", source: null, observed_at: null }] });
  expect(Object.keys(await readModelSuggestions())).toEqual(["claude", "codex"]);
});
