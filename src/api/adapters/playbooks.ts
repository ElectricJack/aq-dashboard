import { ContractError, isRecord } from "./contract";
export const PLAYBOOK_INSPECTION_VERSION = "playbooks-inspection-1";
export const PLAYBOOK_PAGE_SIZE = 25;
export type Namespace = { id: string; generation: string; name: string; projectId: string };
export type Run = { id: string; artifact: string; entry: string; step: string; status: string; outcome: string | null; reason: string | null; root: string; parent: string | null; children: string[]; dependencies: Record<string, string>; pendingKind: string | null; admittedAt: number };
export type Effect = { id: string; step: string; command: string; status: string; deadlineAt: number | null; cancelRequested: boolean };
export type Receipt = { sequence: string; step: string; at: number; kind: string; operation: string | null; outcome: string | null; child: string | null };
export type Admission = { requestId: string; status: string; createdAt: number; runId: string | null; activationRevision: string | null; catalogRevision: string | null };
export type Page<T> = { namespace: Namespace; observedAt: number; revision: string | null; items: T[]; next: string | null };
export type Detail = { namespace: Namespace; observedAt: number; run: Run; effects: Page<Effect>; receipts: Page<Receipt> };
const MAX_WIRE = 262144;
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid playbook inspection response"); }
function text(v: unknown): string { ensure(typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v)); return v; }
function nullable(v: unknown): string | null { return v === null ? null : text(v); }
function uuid(v: unknown): string { const s = text(v); ensure(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s) && s !== "00000000-0000-0000-0000-000000000000"); return s; }
function decimal(v: unknown): string { const s = text(v); ensure(/^(0|[1-9][0-9]{0,19})$/.test(s)); return s; }
function optionalDecimal(v: unknown): string | null { return v === null ? null : decimal(v); }
function clock(v: unknown): number { ensure(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 8640000000000000); return v; }
function namespace(v: unknown, project: string | null): Namespace { ensure(isRecord(v)); const projectId = uuid(v.project_id); const generation = decimal(v.generation); ensure(generation !== "0" && (!project || project === projectId)); return { id: uuid(v.id), generation, name: text(v.name), projectId }; }
function header(v: unknown, project: string | null) { ensure(isRecord(v) && v.api_version === PLAYBOOK_INSPECTION_VERSION && new TextEncoder().encode(JSON.stringify(v)).length <= MAX_WIRE); return { namespace: namespace(v.namespace, project), observedAt: clock(v.server_time_ms) }; }
function array<T>(v: unknown, convert: (x: unknown) => T, max: number): T[] { ensure(Array.isArray(v) && v.length <= max); return v.map(convert); }
function sameNamespace(a: Namespace, b: Namespace) { ensure(a.id === b.id && a.generation === b.generation && a.projectId === b.projectId && a.name === b.name); }
function run(v: unknown): Run {
  ensure(isRecord(v) && isRecord(v.dependencies) && Object.keys(v.dependencies).length <= 128);
  const dependencies = Object.fromEntries(Object.entries(v.dependencies).map(([k, x]) => [text(k), text(x)]));
  const children = array(v.children, text, 128); ensure(new Set(children).size === children.length);
  return { id: text(v.id), artifact: text(v.artifact), entry: text(v.entry), step: text(v.step), status: text(v.status), outcome: nullable(v.outcome), reason: nullable(v.reason), root: text(v.root), parent: nullable(v.parent), children, dependencies, pendingKind: nullable(v.pending_kind), admittedAt: clock(v.admitted_at_ms) };
}
function effect(v: unknown): Effect { ensure(isRecord(v) && typeof v.cancel_requested === "boolean"); return { id: text(v.id), step: text(v.step), command: text(v.command), status: text(v.status), deadlineAt: v.deadline_at_ms === null ? null : clock(v.deadline_at_ms), cancelRequested: v.cancel_requested }; }
function receipt(v: unknown): Receipt { ensure(isRecord(v)); return { sequence: decimal(v.sequence), step: text(v.step), at: clock(v.at_ms), kind: text(v.kind), operation: nullable(v.operation), outcome: nullable(v.outcome), child: nullable(v.child) }; }
function admission(v: unknown): Admission { ensure(isRecord(v)); return { requestId: uuid(v.request_id), status: text(v.status), createdAt: clock(v.created_at_ms), runId: nullable(v.run_id), activationRevision: optionalDecimal(v.activation_revision), catalogRevision: optionalDecimal(v.catalog_revision) }; }
function page<T>(v: unknown, project: string | null, convert: (x: unknown) => T): Page<T> {
  const h = header(v, project); ensure(isRecord(v)); const items = array(v.items, convert, PLAYBOOK_PAGE_SIZE); const next = nullable(v.next_cursor); ensure(!next || next.length <= 256);
  return { ...h, revision: optionalDecimal(v.revision), items, next };
}
export function adaptRuns(v: unknown, project: string | null, after: string | null = null): Page<Run> {
  const p = page(v, project, run); let previous = after;
  for (const r of p.items) { ensure(!previous || r.id > previous); previous = r.id; }
  ensure(!p.next || p.next === previous); return p;
}
export function adaptAdmissions(v: unknown, project: string | null, after: string | null = null): Page<Admission> {
  const p = page(v, project, admission); let previous = after;
  for (const a of p.items) { ensure(!previous || a.requestId > previous); previous = a.requestId; }
  ensure(!p.next || p.next === previous); return p;
}
export function adaptRunDetail(v: unknown, project: string | null, id: string, after: string | null = null): Detail {
  const h = header(v, project); ensure(isRecord(v) && v.observation_is_atomic === false);
  const r = run(v.run); ensure(r.id === id);
  const effects = page(v.effects, project, effect), receipts = page(v.receipts, project, receipt);
  sameNamespace(h.namespace, effects.namespace); sameNamespace(h.namespace, receipts.namespace);
  let previous = after ? BigInt(after) : -1n;
  for (const receipt of receipts.items) { const seq = BigInt(receipt.sequence); ensure(seq > previous); previous = seq; }
  if (receipts.next) ensure(receipts.items.length > 0 && BigInt(receipts.next) === previous);
  ensure(new Set(effects.items.map(e => e.id)).size === effects.items.length);
  return { ...h, run: r, effects, receipts };
}
export function mergeRunPages(pages: Page<Run>[]) {
  ensure(pages.length <= 4); const rows: Run[] = []; let previous = "";
  for (const p of pages) { if (pages[0]) sameNamespace(pages[0].namespace, p.namespace); for (const r of p.items) { ensure(r.id > previous); previous = r.id; rows.push(r); } }
  return rows;
}
export function statusLabel(status: string) { return ({ admitted: "Admitted", running: "Running", waiting: "Waiting", finishing: "Finishing", cancelling: "Cancelling", blocked: "Needs attention", completed: "Completed", failed: "Failed", cancelled: "Cancelled" } as Record<string, string>)[status] ?? "Unsupported state"; }
export function timestamp(ms: number) { return new Date(ms).toISOString(); }
