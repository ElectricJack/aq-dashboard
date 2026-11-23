import { AttachmentRequestError, attachmentRefusal } from "./attachmentRefusal";
export { AttachmentRequestError } from "./attachmentRefusal";
import { readBoundedBody } from "./responseBytes";
import { ContractError } from "./adapters/contract";
import { adaptSupervisorAttachmentError, adaptSupervisorAttachmentUpload, supervisorId, type AttachmentUpload } from "./adapters/supervisor";

const limitBytes = 262144;
async function readJson(response: Response): Promise<unknown> {
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) { void response.body?.cancel(); return undefined; }
  try {
    const bytes = await readBoundedBody(response.body, limitBytes, () => new Error("Attachment response exceeds byte bound"));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return undefined; }
}
export function supervisorAttachmentPath(conversation: string, attachment: string, name?: string): string {
  if (!supervisorId(conversation) || !supervisorId(attachment)) throw new ContractError("Invalid attachment identity");
  return `/api/human/conversations/${conversation}/attachments/${attachment}${name === undefined ? "" : `?name=${encodeURIComponent(name)}`}`;
}
const requestFailure = {
  PUT: "The upload did not complete. Check your connection and try again.",
  DELETE: "The file could not be removed from AQ. Try again.",
} as const;

type AttachmentRequest = { path: string; init: RequestInit & { method: keyof typeof requestFailure }; signal: AbortSignal };

async function attachmentRequest({ path, init, signal }: AttachmentRequest): Promise<Response> {
  try {
    return await fetch(path, {
      credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", ...init,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AttachmentRequestError(requestFailure[init.method], true);
  }
}

/** Stages one file: raw bytes with their exact media type. A retry with the same id and bytes is idempotent. */
export async function uploadSupervisorAttachment(conversation: string, attachment: string, file: { name: string; mediaType: string; bytes: ArrayBuffer }, signal: AbortSignal): Promise<AttachmentUpload> {
  const path = supervisorAttachmentPath(conversation, attachment, file.name);
  const response = await attachmentRequest({ path, signal, init: {
    method: "PUT", signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: { Accept: "application/json", "Content-Type": file.mediaType, "X-AQ-Request": "1" }, body: file.bytes,
  } });
  const raw = await readJson(response);
  if (![200, 201].includes(response.status)) throw attachmentRefusal(response, raw, "store");
  try { return adaptSupervisorAttachmentUpload(raw, { conversation, attachment }); }
  catch { throw new AttachmentRequestError("AQ returned an unexpected upload response, so the file was not attached. Try again.", true); }
}

/** Removes a staged upload. An already-missing upload counts as removed. */
export async function deleteSupervisorAttachment(conversation: string, attachment: string, signal: AbortSignal): Promise<void> {
  const path = supervisorAttachmentPath(conversation, attachment);
  const response = await attachmentRequest({ path, signal, init: {
    method: "DELETE", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { Accept: "application/json", "X-AQ-Request": "1" },
  } });
  const raw = await readJson(response);
  if (response.ok || adaptSupervisorAttachmentError(raw)?.error === "attachment_not_found") return;
  throw attachmentRefusal(response, raw, "remove");
}
