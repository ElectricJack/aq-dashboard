import { PLAYBOOK_NAMESPACE, PLAYBOOK_TIME } from "./playbooks";
export function loadedDefinition(artifact = `sha256:${"a".repeat(64)}`) {
  return { artifact, executable_fingerprint: `sha256:${"b".repeat(64)}`, name: "coding-policy", purpose: "Inspect a change, then request its configured review.", purpose_truncated: false,
    compiler: "labelled UI fixture compiler", source_digest: `sha256:${"c".repeat(64)}`, entries: ["main"], dependency_pins: { checks: `sha256:${"d".repeat(64)}` } };
}
export function loadedDefinitions(items = [loadedDefinition()]) { return { api_version: "playbooks-loaded-definitions-1", namespace: PLAYBOOK_NAMESPACE, server_time_ms: PLAYBOOK_TIME, captured_at_ms: PLAYBOOK_TIME - 1000, source: "runtime_startup_configuration", current_catalog: false, items }; }
