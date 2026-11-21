import { ContractError } from "./adapters/contract";
import { adaptSupervisorAttachmentError, adaptSupervisorAttachmentUpload, supervisorId, type AttachmentErrorCode, type AttachmentUpload } from "./adapters/supervisor";

/** A refusal or failure of an owner attachment route, worded for the person who attached the file. */
export class AttachmentRequestError extends Error {
  override name = "AttachmentRequestError";
  constructor(message: string, readonly retryable: boolean, readonly code?: AttachmentErrorCode) { super(message); }
}
const CODE_TEXT: Record<AttachmentErrorCode, { text: string; retryable: boolean }> = {
  attachment_media_type_unsupported: { text: "This file type is not supported.", retryable: false },
  attachment_too_large: { text: "This file is larger than the server accepts.", retryable: false },
  attachment_name_invalid: { text: "This file name is not accepted.", retryable: false },
  attachment_unreadable: { text: "The file is empty or could not be read as its declared type, so no text can be extracted from it.", retryable: false },
  attachment_id_conflict: { text: "This upload identity was already used for different content.", retryable: false },
  attachment_capacity_exhausted: { text: "Too many files are waiting to be sent. Remove one and try again.", retryable: true },
  attachment_not_found: { text: "The staged file is no longer available.", retryable: false },
  attachment_bound: { text: "This file is already part of a sent message.", retryable: false },
};
const limitBytes = 262144;
async function readJson(response: Response): Promise<unknown> {
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) { void response.body?.cancel(); return undefined; }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limitBytes) return undefined; chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return undefined; } finally { void reader.cancel().catch(() => undefined); }
}
function refusal(response: Response, raw: unknown, verb: string): AttachmentRequestError {
  const known = adaptSupervisorAttachmentError(raw);
  if (known) { const { text, retryable } = CODE_TEXT[known.error]; return new AttachmentRequestError(`${text} (${known.message})`, retryable, known.error); }
  if (response.status === 401 || response.status === 403) return new AttachmentRequestError(`AQ refused to ${verb} this file for your account. Reload and sign in again if this persists.`, false);
  if (response.status === 413) return new AttachmentRequestError("This file is larger than the server accepts.", false, "attachment_too_large");
  return new AttachmentRequestError(`AQ could not ${verb} this file (HTTP ${response.status}). Try again.`, response.status >= 500 || response.status === 429 || response.status === 408);
}
export function supervisorAttachmentPath(conversation: string, attachment: string, name?: string): string {
  if (!supervisorId(conversation) || !supervisorId(attachment)) throw new ContractError("Invalid attachment identity");
  return `/api/human/conversations/${conversation}/attachments/${attachment}${name === undefined ? "" : `?name=${encodeURIComponent(name)}`}`;
}
/** Stages one file: raw bytes with their exact media type. A retry with the same id and bytes is idempotent. */
export async function uploadSupervisorAttachment(conversation: string, attachment: string, file: { name: string; mediaType: string; bytes: ArrayBuffer }, signal: AbortSignal): Promise<AttachmentUpload> {
  const path = supervisorAttachmentPath(conversation, attachment, file.name);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  let response: Response;
  try {
    response = await fetch(path, { method: "PUT", signal: combined, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json", "Content-Type": file.mediaType, "X-AQ-Request": "1" }, body: file.bytes });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AttachmentRequestError("The upload did not complete. Check your connection and try again.", true);
  }
  const raw = await readJson(response);
  if (response.status !== 200 && response.status !== 201) throw refusal(response, raw, "store");
  try { return adaptSupervisorAttachmentUpload(raw, { conversation, attachment }); }
  catch { throw new AttachmentRequestError("AQ returned an unexpected upload response, so the file was not attached. Try again.", true); }
}
/** Removes a staged upload. An already-missing upload counts as removed. */
export async function deleteSupervisorAttachment(conversation: string, attachment: string, signal: AbortSignal): Promise<void> {
  const path = supervisorAttachmentPath(conversation, attachment);
  let response: Response;
  try { response = await fetch(path, { method: "DELETE", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json", "X-AQ-Request": "1" } }); }
  catch (error) { if (signal.aborted) throw error; throw new AttachmentRequestError("The file could not be removed from AQ. Try again.", true); }
  const raw = await readJson(response);
  if (response.ok) return;
  if (adaptSupervisorAttachmentError(raw)?.error === "attachment_not_found") return;
  throw refusal(response, raw, "remove");
}
