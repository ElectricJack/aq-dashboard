import { apiGet, apiSend, ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/**
 * The routing document: the owner's Markdown that an agent turns into the playbook which routes tasks.
 *
 * The editor needs three things of the server: the text with its revision, a save fenced by that revision and an
 * operation id, and the outcome of a save whose answer was lost. `exchange` is the one function that talks to the server
 * for all three. The server keeps the text inside a larger record (`/api/settings/intelligence/structure`) and checks
 * every save against the whole record, so `exchange` sends back the fields this dashboard does not use exactly as it
 * read them. When the server serves the text on a route of its own, `exchange` is the single function to replace; nothing
 * outside this file knows where the text is kept.
 */
export type RoutingDocument = { markdown: string; revision: string };
export type SaveRoutingDocument = { markdown: string; expected_revision: string; operation_id: string };
export type RoutingDocumentSaved = RoutingDocument & { disposition: "saved" | "unchanged" };
export const MAX_ROUTING_DOCUMENT_BYTES = 128 * 1024;

const STORE = "/api/settings/intelligence/structure";
/** The record as the server holds it: the document's text and revision, and whatever else it must be sent back with. */
type StoreRecord = Record<string, unknown> & { revision: string; routing_markdown: string };
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid routing document response"); }
function record(value: unknown): StoreRecord {
  ensure(isRecord(value) && revision(value.revision) && typeof value.routing_markdown === "string" && new TextEncoder().encode(value.routing_markdown).length <= MAX_ROUTING_DOCUMENT_BYTES);
  return value as StoreRecord;
}
const shown = (value: StoreRecord): RoutingDocument => ({ markdown: value.routing_markdown, revision: value.revision });
function saved(value: unknown, operationId: string): RoutingDocumentSaved {
  ensure(isRecord(value) && value.operation_id === operationId && (value.disposition === "saved" || value.disposition === "unchanged"));
  return { ...shown(record(value)), disposition: value.disposition };
}
/** The exact body of each save by operation id, so a retry of a save whose answer was lost sends the same bytes. */
const sent = new Map<string, unknown>();

type Call = { read: AbortSignal | undefined } | { save: SaveRoutingDocument } | { inspect: string };
async function exchange(call: { read: AbortSignal | undefined }): Promise<RoutingDocument>;
async function exchange(call: { save: SaveRoutingDocument } | { inspect: string }): Promise<RoutingDocumentSaved>;
async function exchange(call: Call): Promise<RoutingDocument | RoutingDocumentSaved> {
  if ("read" in call) return shown(record(await apiGet<unknown>(STORE, call.read)));
  if ("inspect" in call) return saved(await apiGet<unknown>(`${STORE}/operations/${encodeURIComponent(call.inspect)}`), call.inspect);
  const { markdown, expected_revision, operation_id } = call.save;
  let body = sent.get(operation_id);
  if (body === undefined) {
    const { revision: current, catalog_revision, routing_markdown: _replaced, ...unused } = record(await apiGet<unknown>(STORE));
    // The save is for the revision the editor read; a newer record is the conflict the server would report.
    if (current !== expected_revision) throw new ApiError("http", "The routing document changed", { status: 409 });
    body = { ...unused, operation_id, expected_revision, expected_catalog_revision: catalog_revision, routing_markdown: markdown };
    if (sent.size >= 16) sent.delete(sent.keys().next().value!);
    sent.set(operation_id, body);
  }
  const result = saved(await apiSend<unknown>("POST", STORE, body), operation_id);
  sent.delete(operation_id);
  return result;
}

export const readRoutingDocument = (signal?: AbortSignal) => exchange({ read: signal });
export const saveRoutingDocument = (request: SaveRoutingDocument) => exchange({ save: request });
export const inspectRoutingDocumentSave = (operationId: string) => exchange({ inspect: operationId });
