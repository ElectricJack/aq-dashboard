import { adaptCatalog, catalogUrl, mergeCatalogPages } from "./playbookCatalog";
import { activationCatalog, catalogActivation, catalogDefinition, definitionCatalog } from "../../test/playbookCatalog";
import { PLAYBOOK_NAMESPACE } from "../../test/playbooks";
const key = catalogDefinition().key;
test("current metadata retains exact identity and lossless state/binding revisions", () => {
  const raw = { ...definitionCatalog(), state_revision: "9007199254740993", metadata_revision: "9007199254740993" };
  const page = adaptCatalog(raw, "definitions", PLAYBOOK_NAMESPACE.project_id); expect(page.stateRevision).toBe("9007199254740993"); expect(page.items[0]?.key).toBe(key);
  const binding = catalogActivation(); binding.record.metadata.revision = "18446744073709551615";
  expect(adaptCatalog(activationCatalog([binding]), "activations", null).items[0]).toMatchObject({ revision: "18446744073709551615", controls: { events: false } });
});
const privateDefinition = { ...catalogDefinition(), record: { ...catalogDefinition().record, metadata: { ...catalogDefinition().record.metadata, authority: { actor: "private" } } } };
test.each([
  { ...definitionCatalog(), api_version: "next" }, { ...definitionCatalog(), component_api_version: "next" }, { ...definitionCatalog(), source: "runtime_startup_configuration" }, { ...definitionCatalog(), current_catalog: false },
  { ...definitionCatalog(), kind: "activations" }, { ...definitionCatalog(), incarnation: 2 }, { ...definitionCatalog(), metadata_revision: "8" }, { ...definitionCatalog(), state_revision: "9223372036854775808" },
  { ...definitionCatalog(), namespace: { ...PLAYBOOK_NAMESPACE, extra: true } }, { ...definitionCatalog(), private_input: true }, definitionCatalog([privateDefinition]),
  definitionCatalog([catalogDefinition(), catalogDefinition()]), definitionCatalog([], key), definitionCatalog([catalogDefinition()], `sha256:${"f".repeat(64)}`),
])("refuses profile/context/shape/private fields and broken positions %#", raw => { expect(() => adaptCatalog(raw, "definitions", null)).toThrow(); });
test("exact and continuation responses must join their requested key and stamp", () => {
  const page = adaptCatalog(definitionCatalog(), "definitions", null);
  expect(() => adaptCatalog(definitionCatalog(), "definitions", null, { exact: `sha256:${"f".repeat(64)}` })).toThrow();
  expect(() => adaptCatalog(definitionCatalog(), "definitions", null, { after: key, stamp: page })).toThrow();
  expect(() => adaptCatalog({ ...definitionCatalog(), incarnation: "3" }, "definitions", null, { exact: key, stamp: page })).toThrow();
  expect(() => adaptCatalog(definitionCatalog(), "definitions", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toThrow();
  const url = new URL(catalogUrl("definitions", PLAYBOOK_NAMESPACE.project_id, { after: key, stamp: page }), "http://aq.test"); expect(url.searchParams.get("after")).toBe(key); expect(url.searchParams.get("incarnation")).toBe("2"); expect(url.searchParams.get("metadata_revision")).toBe("5");
});
test("page merges reject foreign incarnation, namespace and stale metadata rather than mixing catalogs", () => {
  const first = adaptCatalog(definitionCatalog([catalogDefinition()], key), "definitions", null);
  const secondKey = `sha256:${"b".repeat(64)}`;
  const second = adaptCatalog(definitionCatalog([catalogDefinition(secondKey)]), "definitions", null, { after: key, stamp: first });
  expect(mergeCatalogPages([first, second])).toHaveLength(2);
  for (const changed of [{ ...second, incarnation: "3" }, { ...second, metadataRevision: "6" }, { ...second, namespace: { ...second.namespace, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } }, { ...second, after: null }, { ...second, stateRevision: "6" }]) expect(() => mergeCatalogPages([first, changed])).toThrow();
});
test("empty current catalog is valid; opaque activations still require closed controls and unique bindings", () => {
  expect(adaptCatalog(definitionCatalog([]), "definitions", null).items).toEqual([]);
  const unknownControls = { ...catalogActivation(), record: { ...catalogActivation().record, metadata: { ...catalogActivation().record.metadata, controls: { ...catalogActivation().record.metadata.controls, ready: true } } } };
  expect(() => adaptCatalog(activationCatalog([unknownControls]), "activations", null)).toThrow();
  expect(() => adaptCatalog(activationCatalog([catalogActivation(), catalogActivation(`sha256:${"d".repeat(64)}`)]), "activations", null)).toThrow();
});
