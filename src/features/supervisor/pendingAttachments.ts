import type { AttachmentCapability, AttachmentRef, AttachmentUpload } from "../../api/adapters/supervisor";
import { classifyAttachment } from "./attachmentFiles";
export type AttachmentStatus = "uploading" | "staged" | "failed" | "removing";
/** One file the owner picked for the next message. `file` is kept so a failed upload can be retried without re-picking. */
export type PendingAttachment = { id: string; name: string; size: number; mediaType: string | null; status: AttachmentStatus; error?: string; retryable?: boolean; upload?: AttachmentUpload; file?: File };


export function pendingFile(file: File, capability: AttachmentCapability): PendingAttachment {
  const id = crypto.randomUUID();
  const verdict = classifyAttachment(file, capability);
  const base = { id, name: file.name, size: file.size };
  if ("error" in verdict) return { ...base, mediaType: null, status: "failed", error: verdict.error, retryable: false };
  return { ...base, mediaType: verdict.mediaType, status: "uploading", file };
}

export function hasUpload(item: PendingAttachment): item is PendingAttachment & { file: File; mediaType: string } {
  return !!item.file && !!item.mediaType;
}
export function localOnly(item: PendingAttachment) {
  return item.status === "failed" && !item.retryable;
}
export function limitMessage(file: File, maxFiles: number) {
  return `${file.name || "A file"} was not added: a message holds at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`;
}
export function uploadRefs(items: PendingAttachment[]): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  for (const item of items) {
    if (item.status === "staged" && item.upload) refs.push({ id: item.id, digest: item.upload.digest });
  }
  return refs;
}
export function blockedReason(items: PendingAttachment[]) {
  if (items.some(item => item.status === "uploading" || item.status === "removing")) return "Wait for files to finish uploading before sending.";
  if (items.some(item => item.status === "failed")) return "Retry or remove files that did not upload before sending; they would not be included.";
  return null;
}
