import { settingsRevision, settingsSaves, savedRevision } from "./settingsSaves";
import { apiGet } from "./client";
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
/**
 * The most text a read may carry: the server's transport bound on these routes. What a save may hold is the store's
 * `max_document_bytes` limit (Settings → Limits), which the server enforces in its own words.
 */
export const ROUTING_DOCUMENT_READ_BYTES = 8 * 1024 * 1024;

export const ROUTING_DOCUMENT_PATH = "/api/settings/routing-document";
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid routing document response"); }
function shown(value: unknown): RoutingDocument {
  ensure(isRecord(value) && settingsRevision(value.revision) && typeof value.markdown === "string" && value.markdown.length <= ROUTING_DOCUMENT_READ_BYTES);
  return { markdown: value.markdown, revision: value.revision };
}
export const readRoutingDocument = async (signal?: AbortSignal): Promise<RoutingDocument> =>
  shown(await apiGet<unknown>(ROUTING_DOCUMENT_PATH, signal));

const saves = settingsSaves(ROUTING_DOCUMENT_PATH,
  ({ markdown, expected_revision, operation_id }: SaveRoutingDocument) => ({ markdown, expected_revision, operation_id }),
  (receipt, request): RoutingDocumentSaved => ({
    markdown: request.markdown, revision: savedRevision(receipt, "routing document"), disposition: "saved",
  }),
);

export const saveRoutingDocument = saves.save;
/** Inspect an ambiguous outcome by submitting the exact retained operation again. */
export const inspectRoutingDocumentSave = saves.inspect;
