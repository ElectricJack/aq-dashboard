import { ContractError, isRecord } from "./contract";
import { artifactDigest } from "./loadedDefinitions";
import type { Namespace } from "./playbooks";
export const CATALOG_CAPABILITY = "playbooks.catalog.read";
export const CATALOG_VERSION = "playbooks-current-catalog-1";
export type CatalogKind = "definitions" | "activations";
export type Dependency = { binding: string; artifact: string; selection: "exact" | "catalog" };
export type CatalogDefinition = { kind: "definition"; key: string; artifact: string; fingerprint: string; sourceDigest: string; name: string; scope: string; compiler: string; purpose: string; purposeTruncated: boolean; entries: string[]; dependencies: Record<string, Dependency> };
export type CatalogActivation = { kind: "activation"; key: string; binding: string; artifact: string; revision: string; controls: { calls: boolean; events: boolean; execution: boolean }; executionDenied: boolean };
export type CatalogItem = CatalogDefinition | CatalogActivation;
export type CatalogStamp = { namespace: Namespace; kind: CatalogKind; incarnation: string; metadataRevision: string };
export type CatalogRequest = { after?: string | null; exact?: string | null; stamp?: CatalogStamp | null };
export type CatalogPage = CatalogStamp & { observedAt: number; stateRevision: string; items: CatalogItem[]; next: string | null; after: string | null; exact: string | null };
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid current playbook catalog response"); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> { ensure(isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); }
function text(value: unknown, max: number, empty = false): string {
  ensure(typeof value === "string" && (empty || value.length > 0));
  for (let i = 0; i < value.length; i++) { const code = value.charCodeAt(i); if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++i); ensure(next >= 0xdc00 && next <= 0xdfff); } else ensure(code < 0xdc00 || code > 0xdfff); }
  ensure(new TextEncoder().encode(value).length <= max); return value;
}
function name(value: unknown): string { const result = text(value, 128); ensure(/^[A-Za-z0-9_.-]+$/.test(result)); return result; }
function digest(value: unknown): string { ensure(artifactDigest(value)); return value; }
function decimal(value: unknown, max = 9223372036854775807n): string { const result = text(value, 20); ensure(/^[1-9][0-9]*$/.test(result) && BigInt(result) <= max); return result; }
function uuid(value: unknown): string { const result = text(value, 36); ensure(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(result) && result !== "00000000-0000-0000-0000-000000000000"); return result; }
function clock(value: unknown): number { ensure(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000); return value; }
function item(raw: unknown, kind: CatalogKind): CatalogItem {
  exact(raw, ["key", "record"]); const key = digest(raw.key); exact(raw.record, ["kind", "metadata"]); const d = raw.record.metadata;
  if (kind === "definitions") {
    ensure(raw.record.kind === "definition"); exact(d, ["artifact", "executable_fingerprint", "source_digest", "name", "scope", "compiler", "purpose", "purpose_truncated", "entries", "dependencies"]);
    ensure(d.artifact === key && typeof d.purpose_truncated === "boolean" && Array.isArray(d.entries) && d.entries.length > 0 && d.entries.length <= 128);
    const entries = d.entries.map(name); ensure(entries.every((entry, index) => index === 0 || entry > entries[index - 1]!));
    ensure(isRecord(d.dependencies) && Object.keys(d.dependencies).length <= 128);
    const dependencies = Object.fromEntries(Object.entries(d.dependencies).map(([alias, value]) => { exact(value, ["binding", "reference_artifact", "selection"]); ensure(value.selection === "exact" || value.selection === "catalog"); return [name(alias), { binding: name(value.binding), artifact: digest(value.reference_artifact), selection: value.selection } as Dependency]; }));
    return { kind: "definition", key, artifact: digest(d.artifact), fingerprint: digest(d.executable_fingerprint), sourceDigest: digest(d.source_digest), name: name(d.name), scope: name(d.scope), compiler: text(d.compiler, 256), purpose: text(d.purpose, 4096, true), purposeTruncated: d.purpose_truncated, entries, dependencies };
  }
  ensure(raw.record.kind === "activation"); exact(d, ["binding", "artifact", "revision", "controls", "artifact_execution_denied"]); exact(d.controls, ["calls_enabled", "event_starts_enabled", "execution_enabled"]);
  ensure(typeof d.artifact_execution_denied === "boolean" && [d.controls.calls_enabled, d.controls.event_starts_enabled, d.controls.execution_enabled].every(value => typeof value === "boolean"));
  return { kind: "activation", key, binding: text(d.binding, 512), artifact: digest(d.artifact), revision: decimal(d.revision, 18446744073709551615n), controls: { calls: d.controls.calls_enabled as boolean, events: d.controls.event_starts_enabled as boolean, execution: d.controls.execution_enabled as boolean }, executionDenied: d.artifact_execution_denied };
}
export function sameCatalog(a: CatalogStamp, b: CatalogStamp): boolean { return a.kind === b.kind && a.incarnation === b.incarnation && a.metadataRevision === b.metadataRevision && a.namespace.id === b.namespace.id && a.namespace.generation === b.namespace.generation && a.namespace.projectId === b.namespace.projectId && a.namespace.name === b.namespace.name; }
export function adaptCatalog(raw: unknown, kind: CatalogKind, project: string | null, request: CatalogRequest = {}): CatalogPage {
  exact(raw, ["api_version", "component_api_version", "source", "current_catalog", "namespace", "server_time_ms", "kind", "state_revision", "incarnation", "metadata_revision", "items", "next_cursor"]);
  ensure(raw.api_version === CATALOG_VERSION && raw.component_api_version === "playbooks-catalog-1" && raw.source === "current_namespace_state" && raw.current_catalog === true && raw.kind === kind && new TextEncoder().encode(JSON.stringify(raw)).length <= 262144);
  exact(raw.namespace, ["id", "generation", "name", "project_id"]); const projectId = uuid(raw.namespace.project_id); ensure(!project || project === projectId);
  const namespace = { id: uuid(raw.namespace.id), generation: decimal(raw.namespace.generation), name: text(raw.namespace.name, 128), projectId };
  const incarnation = decimal(raw.incarnation), metadataRevision = decimal(raw.metadata_revision), stateRevision = decimal(raw.state_revision); ensure(BigInt(metadataRevision) <= BigInt(stateRevision));
  ensure(Array.isArray(raw.items) && raw.items.length <= 25); const items = raw.items.map(row => item(row, kind));
  ensure(items.every((row, index) => index === 0 || row.key > items[index - 1]!.key));
  if (kind === "activations") ensure(new Set(items.map(row => (row as CatalogActivation).binding)).size === items.length);
  const after = request.after ? digest(request.after) : null, selected = request.exact ? digest(request.exact) : null;
  ensure(!(after && selected) && (!after || request.stamp));
  ensure(items.every(row => (!after || row.key > after) && (!selected || row.key === selected)) && (!selected || items.length <= 1));
  const next = raw.next_cursor === null ? null : digest(raw.next_cursor); ensure(!next || (!selected && items.length > 0 && next === items.at(-1)!.key));
  const page = { namespace, kind, incarnation, metadataRevision, stateRevision, observedAt: clock(raw.server_time_ms), items, next, after, exact: selected };
  ensure(!request.stamp || sameCatalog(page, request.stamp)); return page;
}
export function mergeCatalogPages(pages: CatalogPage[]): CatalogItem[] {
  ensure(pages.length > 0 && pages.length <= 4); const first = pages[0]!, rows: CatalogItem[] = []; let last: CatalogPage | undefined;
  for (const page of pages) {
    ensure(sameCatalog(first, page) && !page.exact && page.after === (last?.next ?? null) && (!last || (last.next && BigInt(page.stateRevision) >= BigInt(last.stateRevision))));
    for (const row of page.items) { ensure(rows.length === 0 || row.key > rows.at(-1)!.key); rows.push(row); } last = page;
  }
  if (first.kind === "activations") ensure(new Set(rows.map(row => (row as CatalogActivation).binding)).size === rows.length);
  return rows;
}
export function catalogUrl(kind: CatalogKind, project: string | null, request: CatalogRequest = {}): string {
  const query = new URLSearchParams({ limit: "25" }); if (project) query.set("project_id", project); if (request.after) query.set("after", request.after); if (request.exact) query.set("exact", request.exact);
  if (request.stamp) { query.set("incarnation", request.stamp.incarnation); query.set("metadata_revision", request.stamp.metadataRevision); }
  return `/api/playbooks/inspection/catalog/${kind}?${query}`;
}
