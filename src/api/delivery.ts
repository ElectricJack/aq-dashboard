import { apiGet, apiSend, ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/**
 * Delivery settings: the owner's delivery Markdown document and the delivery limits. Both are served on routes of
 * their own, shaped like the routing document (`routingDocument.ts`):
 *
 * - `/api/settings/delivery-document`: `GET` answers `{markdown, revision}`; `PUT {markdown, expected_revision, operation_id}` saves.
 * - `/api/settings/delivery-limits`: `GET` answers `{limits, revision}`; `PUT {limits, expected_revision, operation_id}` saves.
 *
 * A save is fenced by the revision it read (409 when the settings moved on). The same operation sent again answers as
 * the first time and saves nothing, so the outcome of a save whose answer was lost is read by sending it again.
 * A server built without delivery answers 404 on both routes (`isDeliveryUnavailable`).
 */
export const DELIVERY_DOCUMENT_PATH = "/api/settings/delivery-document";
export const DELIVERY_LIMITS_PATH = "/api/settings/delivery-limits";
/** The most text a read may carry: the transport bound on these routes (the same as the routing document). */
export const DELIVERY_DOCUMENT_READ_BYTES = 8 * 1024 * 1024;

export type DeliveryDocument = { markdown: string; revision: string };
export type SaveDeliveryDocument = { markdown: string; expected_revision: string; operation_id: string };

export const DELIVERY_LIMIT_KEYS = ["main_sync_interval_ms", "main_freshness_ms", "decision_repeat_ms", "longest_check_wait_ms", "git_transfer_timeout_ms", "max_push_bytes"] as const;
export type DeliveryLimitKey = typeof DELIVERY_LIMIT_KEYS[number];
export type DeliveryLimits = Record<DeliveryLimitKey, number>;
export type DeliveryLimitsRead = { limits: DeliveryLimits; revision: string };
export type SaveDeliveryLimits = { limits: DeliveryLimits; expected_revision: string; operation_id: string };

/** The server has no delivery (its build has the feature off): it answers 404 on these routes. */
export const isDeliveryUnavailable = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

const revision = (value: unknown): value is string => typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);
function ensure(condition: unknown, what: string): asserts condition { if (!condition) throw new ContractError(`Invalid ${what} response`); }

/** The saves this page has sent, by operation id, so a retry or a status check sends exactly the same save. */
function saver<S extends { operation_id: string }>(path: string, what: string, copy: (request: S) => S) {
  const sent = new Map<string, S>();
  async function save(request: S): Promise<string> {
    const body = sent.get(request.operation_id) ?? copy(request);
    if (!sent.has(body.operation_id)) { if (sent.size >= 16) sent.delete(sent.keys().next().value!); sent.set(body.operation_id, body); }
    let receipt: unknown;
    try { receipt = await apiSend<unknown>("PUT", path, body); } catch (error) {
      // A refusal is an answer: the save is over. Anything else leaves it kept for the retry.
      if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) sent.delete(body.operation_id);
      throw error;
    }
    ensure(isRecord(receipt) && revision(receipt.revision), what);
    sent.delete(body.operation_id);
    return receipt.revision;
  }
  /** The same save again; a save this page did not send cannot be checked. */
  async function inspect(operationId: string): Promise<string> {
    const body = sent.get(operationId);
    if (!body) throw new ApiError("http", "This save was not sent from this page", { status: 404 });
    return save(body);
  }
  return { save, inspect };
}

export async function readDeliveryDocument(signal?: AbortSignal): Promise<DeliveryDocument> {
  const value = await apiGet<unknown>(DELIVERY_DOCUMENT_PATH, signal);
  ensure(isRecord(value) && revision(value.revision) && typeof value.markdown === "string" && value.markdown.length <= DELIVERY_DOCUMENT_READ_BYTES, "delivery document");
  return { markdown: value.markdown, revision: value.revision };
}
const documentSaves = saver<SaveDeliveryDocument>(DELIVERY_DOCUMENT_PATH, "delivery document", request => ({ ...request }));
/** Saves the document and answers the new revision. */
export const saveDeliveryDocument = (request: SaveDeliveryDocument): Promise<string> => documentSaves.save(request);
export const inspectDeliveryDocumentSave = (operationId: string): Promise<string> => documentSaves.inspect(operationId);

export async function readDeliveryLimits(signal?: AbortSignal): Promise<DeliveryLimitsRead> {
  const value = await apiGet<unknown>(DELIVERY_LIMITS_PATH, signal);
  ensure(isRecord(value) && revision(value.revision) && isRecord(value.limits), "delivery limits");
  const limits = {} as DeliveryLimits;
  for (const key of DELIVERY_LIMIT_KEYS) {
    const field = value.limits[key];
    ensure(typeof field === "number" && Number.isSafeInteger(field) && field >= 0, "delivery limits");
    limits[key] = field;
  }
  return { limits, revision: value.revision };
}
const limitSaves = saver<SaveDeliveryLimits>(DELIVERY_LIMITS_PATH, "delivery limits", request => ({ ...request, limits: { ...request.limits } }));
/** Saves the limits and answers the new revision. */
export const saveDeliveryLimits = (request: SaveDeliveryLimits): Promise<string> => limitSaves.save(request);
export const inspectDeliveryLimitsSave = (operationId: string): Promise<string> => limitSaves.inspect(operationId);

/** How each limit is shown: in the unit an owner thinks in, converted to the milliseconds or bytes the server holds. */
export type LimitUnit = "seconds" | "minutes" | "MB";
export const DELIVERY_LIMIT_FIELDS: readonly { key: DeliveryLimitKey; label: string; unit: LimitUnit; help: string }[] = [
  { key: "main_sync_interval_ms", label: "Main sync interval", unit: "seconds", help: "How often the central copy of main is brought up to date from GitHub." },
  { key: "main_freshness_ms", label: "Main freshness", unit: "seconds", help: "How old the central copy of main may be when a task starts from it." },
  { key: "decision_repeat_ms", label: "Decision repeat", unit: "seconds", help: "How long to wait before the delivery playbook decides about the same task again." },
  { key: "longest_check_wait_ms", label: "Longest check wait", unit: "minutes", help: "The longest the playbook waits for a pull request's checks to finish." },
  { key: "git_transfer_timeout_ms", label: "Git transfer timeout", unit: "seconds", help: "The longest one push or fetch of git data may take." },
  { key: "max_push_bytes", label: "Largest push", unit: "MB", help: "The most data one task's push may carry (1 MB is 1,048,576 bytes)." },
];
const UNIT_FACTOR: Record<LimitUnit, number> = { seconds: 1000, minutes: 60_000, MB: 1024 * 1024 };

/** A stored value in its unit, as text for the field. */
export const limitToText = (value: number, unit: LimitUnit): string => String(value / UNIT_FACTOR[unit]);
/** The text of a field as the stored value, or the reason it cannot be one. */
export function limitFromText(text: string, unit: LimitUnit): { value: number } | { problem: string } {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { problem: "Enter a number, such as 30." };
  const exact = Number(trimmed) * UNIT_FACTOR[unit];
  const value = Math.round(exact);
  if (Math.abs(value - exact) > 1e-6) return { problem: unit === "MB" ? "Enter a size that is a whole number of bytes." : "Enter a time that is a whole number of milliseconds." };
  if (value < 1) return { problem: "Must be more than zero." };
  if (!Number.isSafeInteger(value)) return { problem: "That is too large." };
  return { value };
}
