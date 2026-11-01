import examples from "../../contracts/live/current-playbook-catalog/examples.json";
import { PLAYBOOK_NAMESPACE } from "./playbooks";
export function catalogDefinition(key = `sha256:${"a".repeat(64)}`) {
  const item = structuredClone(examples.definitions.items[0]!); item.key = key; item.record.metadata.artifact = key; return item;
}
export function catalogActivation(key = `sha256:${"c".repeat(64)}`) {
  const item = structuredClone(examples.activations.items[0]!); item.key = key; item.record.metadata.artifact = catalogDefinition().key; return item;
}
export function definitionCatalog(items = [catalogDefinition()], next: string | null = null) { return { ...structuredClone(examples.definitions), namespace: PLAYBOOK_NAMESPACE, items, next_cursor: next }; }
export function activationCatalog(items = [catalogActivation()], next: string | null = null) { return { ...structuredClone(examples.activations), namespace: PLAYBOOK_NAMESPACE, items, next_cursor: next }; }
