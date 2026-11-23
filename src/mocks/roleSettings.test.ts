import { setupServer } from "msw/node";
import { problemsOf, readDocument, readProfileSnapshot, saveDocument } from "../api/roleSettings";
import { roleSettingsHandlers } from "./roleSettings";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => server.use(...roleSettingsHandlers()));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const fence = { expected_revision: "1", operation_id: "fixture-save" };

test.each(["none", "USD"])("selection fields retain their types with currency %s", async currency => {
  const before = await readDocument("intelligence", "standard-low");
  const markdown = `${before.markdown}\n## Selection
- max_attempts: 3
- fallback_on: [unavailable]
- max_lineage_elapsed_ms: 1000
- observation_max_age_ms: 2000
- allow_unknown_availability: true
- unknown_cost: allow_bounded
- require_complete_accounting: false
- require_hard_cost_enforcement: true
- max_cost_microunits: ${currency === "none" ? "none" : "500"}
- currency: ${currency === "none" ? "none" : '"USD"'}
`;
  await saveDocument("intelligence", before.id, { ...fence, markdown });
  expect((await readDocument("intelligence", before.id)).fields?.selection).toEqual({
    max_attempts: 3, fallback_on: ["unavailable"], max_lineage_elapsed_ms: 1000,
    observation_max_age_ms: 2000, allow_unknown_availability: true, unknown_cost: "allow_bounded",
    require_complete_accounting: false, require_hard_cost_enforcement: true,
    max_cost_microunits: currency === "none" ? null : 500, currency: currency === "none" ? null : "USD",
  });
});

test("candidate validation reports duplicate, empty and incompatible harnesses in order", async () => {
  const before = await readDocument("intelligence", "standard-low");
  const markdown = before.markdown.replace("| fixture-provider | fixture-model | low | opencode |", [
    "| fixture-provider | fixture-model | low | |",
    "| fixture-provider | fixture-model | low | missing, codex, claude, gemini |",
  ].join("\n"));
  const snapshot = await readProfileSnapshot();
  const error = await saveDocument("intelligence", before.id, { ...fence, markdown }).catch(error => error);
  expect(error).toMatchObject({ status: 400 });
  expect(problemsOf(error).map(problem => problem.message)).toEqual([
    "`fixture-provider:fixture-model:low` names no harness",
    "`fixture-provider:fixture-model:low` is listed twice",
    "`missing` is not a harness",
    "the `codex` harness takes provider `openai`, not `fixture-provider`",
    "the `claude` harness takes provider `anthropic`, not `fixture-provider`",
    "the `gemini` harness does not accept reasoning `low`",
  ]);
  expect(await readProfileSnapshot()).toEqual(snapshot);
  expect(await readDocument("intelligence", before.id)).toEqual(before);
});

test("execution validation reports missing credentials before extra credentials", async () => {
  const before = await readDocument("execution", "fixture-sandbox");
  const markdown = before.markdown.replace("- codex: fixture-codex-credential", "- other: fixture-other-credential");
  const error = await saveDocument("execution", before.id, { ...fence, markdown }).catch(error => error);
  expect(error).toMatchObject({ status: 400 });
  expect(problemsOf(error)).toEqual([
    { document: "execution profile `fixture-sandbox`", field: "credentials", message: "no credential profile is given for `codex`" },
    { document: "execution profile `fixture-sandbox`", field: "credentials", message: "`other` is not one of this profile's harnesses" },
  ]);
  expect(await readDocument("execution", before.id)).toEqual(before);
});

test("selection parse refusals retain the original line and leave stored text intact", async () => {
  const before = await readDocument("intelligence", "standard-low");
  const markdown = `${before.markdown}\n## Selection\n- allow_unknown_availability: maybe\n`;
  const line = markdown.split("\n").findIndex(text => text.includes("maybe")) + 1;
  const error = await saveDocument("intelligence", before.id, { ...fence, markdown }).catch(error => error);
  expect(problemsOf(error)).toEqual([
    { document: "intelligence profile document `standard-low`", field: `line ${line}`, message: "`allow_unknown_availability` expects `true` or `false`" },
  ]);
  expect(await readDocument("intelligence", before.id)).toEqual(before);
});
