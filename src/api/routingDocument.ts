import { apiGet, apiSend, ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/**
 * The routing document: the owner's Markdown that an agent turns into the playbook which routes tasks.
 *
 * The server serves it on a route of its own (`/api/settings/routing-document`, aq-role-settings): `GET` answers
 * `{markdown, revision}`, and `PUT {markdown, expected_revision, operation_id}` answers `{revision, digest}`. A save is
 * fenced by the revision it read (409 when the document moved on). The same operation sent again answers as the first
 * time and saves nothing; the same operation id with another text is a conflict. There is no route that reads a save's
 * outcome by its id, so the outcome of a save whose answer was lost is read by sending the same save again.
 */
export type RoutingDocument = { markdown: string; revision: string };
export type SaveRoutingDocument = { markdown: string; expected_revision: string; operation_id: string };
export type RoutingDocumentSaved = RoutingDocument & { disposition: "saved" | "unchanged" };
export const MAX_ROUTING_DOCUMENT_BYTES = 128 * 1024;

export const ROUTING_DOCUMENT_PATH = "/api/settings/routing-document";
const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid routing document response"); }
function shown(value: unknown): RoutingDocument {
  ensure(isRecord(value) && revision(value.revision) && typeof value.markdown === "string" && new TextEncoder().encode(value.markdown).length <= MAX_ROUTING_DOCUMENT_BYTES);
  return { markdown: value.markdown, revision: value.revision };
}
/** The saves this page has sent, by operation id, so a retry or a status check sends exactly the same save. */
const sent = new Map<string, SaveRoutingDocument>();

export const readRoutingDocument = async (signal?: AbortSignal): Promise<RoutingDocument> => shown(await apiGet<unknown>(ROUTING_DOCUMENT_PATH, signal));

export async function saveRoutingDocument(request: SaveRoutingDocument): Promise<RoutingDocumentSaved> {
  const save = sent.get(request.operation_id) ?? { markdown: request.markdown, expected_revision: request.expected_revision, operation_id: request.operation_id };
  if (!sent.has(save.operation_id)) { if (sent.size >= 16) sent.delete(sent.keys().next().value!); sent.set(save.operation_id, save); }
  let receipt: unknown;
  try { receipt = await apiSend<unknown>("PUT", ROUTING_DOCUMENT_PATH, save); } catch (error) {
    // A refusal is an answer: the save is over. Anything else leaves it kept for the retry.
    if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) sent.delete(save.operation_id);
    throw error;
  }
  ensure(isRecord(receipt) && revision(receipt.revision));
  sent.delete(save.operation_id);
  return { markdown: save.markdown, revision: receipt.revision, disposition: "saved" };
}

/**
 * The outcome of a save whose answer was lost: the same save again, which the server answers as it did the first time
 * (or performs, if the first never arrived). A save this page did not send cannot be checked; that reads as not recorded.
 */
export async function inspectRoutingDocumentSave(operationId: string): Promise<RoutingDocumentSaved> {
  const save = sent.get(operationId);
  if (!save) throw new ApiError("http", "This save was not sent from this page", { status: 404 });
  return saveRoutingDocument(save);
}
