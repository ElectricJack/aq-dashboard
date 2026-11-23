import { adaptSupervisorAttachmentError, type AttachmentErrorCode } from "./adapters/supervisor";

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
export function attachmentRefusal(response: Response, raw: unknown, verb: "store" | "remove"): AttachmentRequestError {
  const known = adaptSupervisorAttachmentError(raw);
  if (known) { const { text, retryable } = CODE_TEXT[known.error]; return new AttachmentRequestError(`${text} (${known.message})`, retryable, known.error); }
  if ([401, 403].includes(response.status)) return new AttachmentRequestError(`AQ refused to ${verb} this file for your account. Reload and sign in again if this persists.`, false);
  if (response.status === 413) return new AttachmentRequestError("This file is larger than the server accepts.", false, "attachment_too_large");
  return new AttachmentRequestError(`AQ could not ${verb} this file (HTTP ${response.status}). Try again.`, response.status >= 500 || [429, 408].includes(response.status));
}
