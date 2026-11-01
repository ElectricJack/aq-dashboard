import { ContractError, isRecord } from "./contract";
import type { Namespace } from "./playbooks";

export const LOADED_DEFINITIONS_VERSION = "playbooks-loaded-definitions-1";
export const LOADED_DEFINITIONS_CAPABILITY = "playbooks.loaded-definitions.read";
export type LoadedDefinition = {
  artifact: string; fingerprint: string; name: string; purpose: string; purposeTruncated: boolean;
  compiler: string; sourceDigest: string; entries: string[]; dependencies: Record<string, string>;
};
export type LoadedDefinitions = { namespace: Namespace; observedAt: number; capturedAt: number; items: LoadedDefinition[] };
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid loaded playbook definitions response"); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  ensure(isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function text(value: unknown, max: number, empty = false): string {
  ensure(typeof value === "string" && (empty || value.length > 0));
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); ensure(next >= 0xdc00 && next <= 0xdfff); }
    else ensure(code < 0xdc00 || code > 0xdfff);
  }
  ensure(new TextEncoder().encode(value).length <= max); return value;
}
function name(value: unknown): string { const result = text(value, 128); ensure(/^[A-Za-z0-9_.-]+$/.test(result)); return result; }
export function artifactDigest(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
function digest(value: unknown): string { ensure(artifactDigest(value)); return value; }
function uuid(value: unknown): string { const result = text(value, 36); ensure(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(result) && result !== "00000000-0000-0000-0000-000000000000"); return result; }
function clock(value: unknown): number { ensure(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000); return value; }
function definition(raw: unknown): LoadedDefinition {
  exact(raw, ["artifact", "executable_fingerprint", "name", "purpose", "purpose_truncated", "compiler", "source_digest", "entries", "dependency_pins"]);
  ensure(typeof raw.purpose_truncated === "boolean" && Array.isArray(raw.entries) && raw.entries.length > 0 && raw.entries.length <= 128);
  const entries = raw.entries.map(name); ensure(entries.every((entry, index) => index === 0 || entry > entries[index - 1]!));
  ensure(isRecord(raw.dependency_pins) && Object.keys(raw.dependency_pins).length <= 128);
  const dependencies = Object.fromEntries(Object.entries(raw.dependency_pins).map(([key, value]) => [name(key), digest(value)]));
  return { artifact: digest(raw.artifact), fingerprint: digest(raw.executable_fingerprint), name: name(raw.name), purpose: text(raw.purpose, 4096, true), purposeTruncated: raw.purpose_truncated,
    compiler: text(raw.compiler, 256), sourceDigest: digest(raw.source_digest), entries, dependencies };
}
export function adaptLoadedDefinitions(raw: unknown, project: string | null): LoadedDefinitions {
  exact(raw, ["api_version", "namespace", "server_time_ms", "captured_at_ms", "source", "current_catalog", "items"]);
  ensure(raw.api_version === LOADED_DEFINITIONS_VERSION && raw.source === "runtime_startup_configuration" && raw.current_catalog === false);
  ensure(new TextEncoder().encode(JSON.stringify(raw)).length <= 262144);
  exact(raw.namespace, ["id", "generation", "name", "project_id"]);
  const projectId = uuid(raw.namespace.project_id), generation = text(raw.namespace.generation, 19);
  ensure(/^[1-9][0-9]*$/.test(generation) && BigInt(generation) <= 9223372036854775807n && (!project || project === projectId));
  ensure(Array.isArray(raw.items) && raw.items.length > 0 && raw.items.length <= 4);
  const items = raw.items.map(definition); ensure(items.every((item, index) => index === 0 || item.artifact > items[index - 1]!.artifact));
  return { namespace: { id: uuid(raw.namespace.id), generation, name: text(raw.namespace.name, 128), projectId }, observedAt: clock(raw.server_time_ms), capturedAt: clock(raw.captured_at_ms), items };
}
