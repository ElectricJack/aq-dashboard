import { adaptLoadedDefinitions } from "./loadedDefinitions";
import { loadedDefinition, loadedDefinitions } from "../../test/loadedDefinitions";
import { PLAYBOOK_NAMESPACE } from "../../test/playbooks";

test("loaded metadata retains exact immutable identities and configuration provenance", () => {
  const value = adaptLoadedDefinitions(loadedDefinitions(), PLAYBOOK_NAMESPACE.project_id);
  expect(value.items[0]?.artifact).toBe(`sha256:${"a".repeat(64)}`);
  expect(value.items[0]?.dependencies.checks).toBe(`sha256:${"d".repeat(64)}`);
  expect(value.namespace.generation).toBe("1");
});
test.each([
  { ...loadedDefinitions(), api_version: "playbooks-inspection-1" },
  { ...loadedDefinitions(), source: "current_engine_catalog" },
  { ...loadedDefinitions(), current_catalog: true },
  { ...loadedDefinitions(), installed: true },
  loadedDefinitions([]), loadedDefinitions(Array.from({ length: 5 }, () => loadedDefinition())),
  loadedDefinitions([loadedDefinition(), loadedDefinition()]),
  loadedDefinitions([{ ...loadedDefinition(), artifact: "sha256:invalid" }]),
  loadedDefinitions([{ ...loadedDefinition(), registry: { private: true } }]),
  loadedDefinitions([{ ...loadedDefinition(), entries: ["main", "main"] }]),
  loadedDefinitions([{ ...loadedDefinition(), purpose: "é".repeat(2049) }]),
  loadedDefinitions([{ ...loadedDefinition(), purpose: "\ud800" }]),
  { ...loadedDefinitions(), namespace: { ...PLAYBOOK_NAMESPACE, generation: "9223372036854775808" } },
])("refuses unsupported provenance, oversized or malformed metadata %#", value => {
  expect(() => adaptLoadedDefinitions(value, null)).toThrow();
});
test("foreign project refuses and large exact namespace generation stays a string", () => {
  const raw = { ...loadedDefinitions(), namespace: { ...PLAYBOOK_NAMESPACE, generation: "9007199254740993" } };
  expect(adaptLoadedDefinitions(raw, null).namespace.generation).toBe("9007199254740993");
  expect(() => adaptLoadedDefinitions(raw, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toThrow();
});
