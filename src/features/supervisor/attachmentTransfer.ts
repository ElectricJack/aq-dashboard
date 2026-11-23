import type { AttachmentUpload } from "../../api/adapters/supervisor";
import { AttachmentRequestError, deleteSupervisorAttachment, uploadSupervisorAttachment } from "../../api/supervisorAttachmentClient";
async function sha256(bytes: ArrayBuffer): Promise<string> {
  return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("")}`;
}
export const failureText = (error: unknown) => error instanceof AttachmentRequestError ? error.message : "The file could not be uploaded. Try again.";


type UploadJob = { conversation: string; id: string; file: File; mediaType: string; signal: AbortSignal };
function matchesStoredFile(stored: AttachmentUpload, job: UploadJob, bytes: ArrayBuffer, digest: string) {
  const sameContents = stored.digest === digest && stored.size_bytes === bytes.byteLength;
  return sameContents && stored.name === job.file.name && stored.media_type === job.mediaType;
}
export function withdraw(conversation: string, id: string) {
  return deleteSupervisorAttachment(conversation, id, new AbortController().signal);
}
export function discard(conversation: string, id: string) {
  void withdraw(conversation, id).catch(() => undefined);
}
export async function storeFile(job: UploadJob) {
  const bytes = await job.file.arrayBuffer();
  const digest = await sha256(bytes);
  const upload = await uploadSupervisorAttachment(job.conversation, job.id, { name: job.file.name, mediaType: job.mediaType, bytes }, job.signal);
  if (matchesStoredFile(upload, job, bytes, digest)) return upload;
  discard(job.conversation, job.id);
  throw new AttachmentRequestError("AQ stored different content than the file you picked, so it was not attached. Try again.", true);
}
