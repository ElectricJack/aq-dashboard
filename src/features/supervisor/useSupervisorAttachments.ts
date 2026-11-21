import { useCallback, useEffect, useRef, useState } from "react";
import { validAttachmentName, type AttachmentCapability, type AttachmentRef, type AttachmentUpload } from "../../api/adapters/supervisor";
import { AttachmentRequestError, deleteSupervisorAttachment, uploadSupervisorAttachment } from "../../api/supervisorAttachmentClient";

export type AttachmentStatus = "uploading" | "staged" | "failed" | "removing";
/** One file the owner picked for the next message. `file` is kept so a failed upload can be retried without re-picking. */
export type PendingAttachment = { id: string; name: string; size: number; mediaType: string | null; status: AttachmentStatus; error?: string; retryable?: boolean; upload?: AttachmentUpload; file?: File };

const EXTENSION_TYPES: Record<string, string> = { pdf: "application/pdf", md: "text/markdown", markdown: "text/markdown", txt: "text/plain", text: "text/plain", csv: "text/csv", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
export const ATTACHMENT_TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "text/markdown": "Markdown", "text/plain": "Text", "text/csv": "CSV", "application/json": "JSON",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX", "image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WebP" };
export function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 102.4) / 10} KiB` : `${Math.round(bytes / 104857.6) / 10} MiB`; }
/** The `accept` hint for the file picker: exact media types plus the extensions browsers often leave untyped. */
export function attachmentAccept(capability: AttachmentCapability): string {
  const extensions = Object.entries(EXTENSION_TYPES).filter(([, type]) => (capability.media_types as string[]).includes(type)).map(([ext]) => `.${ext}`);
  return [...capability.media_types, ...extensions].join(",");
}
const utf8Bytes = (v: string) => new TextEncoder().encode(v).length;
/** The media type to upload, or the reason this file cannot be attached. Nothing here is silently dropped. */
export function classifyAttachment(file: { name: string; size: number; type: string }, capability: AttachmentCapability): { mediaType: string } | { error: string } {
  if (!validAttachmentName(file.name) || utf8Bytes(file.name) > capability.max_name_bytes) return { error: `The file name is not accepted (use a plain name of at most ${capability.max_name_bytes} bytes, without slashes or control characters).` };
  if (file.size === 0) return { error: "The file is empty, so there is nothing to review." };
  if (file.size > capability.max_file_bytes) return { error: `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(capability.max_file_bytes)}.` };
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  const declared = file.type.toLowerCase();
  const mediaType = (capability.media_types as string[]).includes(declared) ? declared : declared === "" || declared === "application/octet-stream" ? EXTENSION_TYPES[extension] : undefined;
  if (!mediaType || !(capability.media_types as string[]).includes(mediaType)) return { error: `This file type is not supported. Attach ${capability.media_types.map(t => ATTACHMENT_TYPE_LABEL[t] ?? t).join(", ")} files.` };
  return { mediaType };
}
async function sha256(bytes: ArrayBuffer): Promise<string> {
  return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("")}`;
}
const failureText = (error: unknown) => error instanceof AttachmentRequestError ? error.message : "The file could not be uploaded. Try again.";

/**
 * Owner attachments for the next supervisor message: stage each file immediately, show progress, allow removal, and expose the
 * ordered `{id, digest}` refs a Create binds. Files never leave the list silently; every failure stays visible until removed.
 */
export function useSupervisorAttachments(conversation: string | undefined, capability: AttachmentCapability | undefined, maxFiles: number) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<PendingAttachment[]>([]), jobs = useRef(new Map<string, AbortController>()), active = useRef(true);
  const commit = useCallback((next: PendingAttachment[]) => { itemsRef.current = next; if (active.current) setItems(next); }, []);
  const patch = useCallback((id: string, change: Partial<PendingAttachment>) => commit(itemsRef.current.map(item => item.id === id ? { ...item, ...change } : item)), [commit]);
  useEffect(() => { active.current = true; return () => { active.current = false; for (const job of jobs.current.values()) job.abort(); jobs.current.clear(); }; }, []);
  useEffect(() => { for (const job of jobs.current.values()) job.abort(); jobs.current.clear(); commit([]); setNotice(null); }, [conversation, commit]);

  const upload = useCallback(async (id: string, file: File, mediaType: string) => {
    if (!conversation) return;
    const owner = new AbortController(); jobs.current.set(id, owner);
    patch(id, { status: "uploading", error: undefined, retryable: undefined });
    try {
      const bytes = await file.arrayBuffer(), digest = await sha256(bytes);
      const stored = await uploadSupervisorAttachment(conversation, id, { name: file.name, mediaType, bytes }, owner.signal);
      if (stored.digest !== digest || stored.size_bytes !== bytes.byteLength || stored.name !== file.name || stored.media_type !== mediaType) {
        void deleteSupervisorAttachment(conversation, id, new AbortController().signal).catch(() => undefined);
        throw new AttachmentRequestError("AQ stored different content than the file you picked, so it was not attached. Try again.", true);
      }
      if (!owner.signal.aborted) patch(id, { status: "staged", upload: stored });
    } catch (error) {
      if (owner.signal.aborted) return;
      patch(id, { status: "failed", error: failureText(error), retryable: error instanceof AttachmentRequestError ? error.retryable : true });
    } finally { if (jobs.current.get(id) === owner) jobs.current.delete(id); }
  }, [conversation, patch]);

  const add = useCallback((files: Iterable<File>) => {
    if (!conversation || !capability) return;
    const messages: string[] = [];
    for (const file of files) {
      const counted = itemsRef.current.filter(item => !(item.status === "failed" && !item.retryable)).length;
      if (counted >= maxFiles) { messages.push(`${file.name || "A file"} was not added: a message holds at most ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`); continue; }
      const id = crypto.randomUUID(), verdict = classifyAttachment(file, capability);
      if ("error" in verdict) { commit([...itemsRef.current, { id, name: file.name, size: file.size, mediaType: null, status: "failed", error: verdict.error, retryable: false }]); continue; }
      commit([...itemsRef.current, { id, name: file.name, size: file.size, mediaType: verdict.mediaType, status: "uploading", file }]);
      void upload(id, file, verdict.mediaType);
    }
    setNotice(messages.length ? messages.join(" ") : null);
  }, [conversation, capability, maxFiles, commit, upload]);

  const retry = useCallback((id: string) => {
    const item = itemsRef.current.find(entry => entry.id === id);
    if (item?.status === "failed" && item.retryable && item.file && item.mediaType) void upload(id, item.file, item.mediaType);
  }, [upload]);

  const remove = useCallback(async (id: string) => {
    const item = itemsRef.current.find(entry => entry.id === id);
    if (!item || !conversation || item.status === "removing") return;
    const wasUploading = item.status === "uploading", local = item.status === "failed" && !item.retryable;
    jobs.current.get(id)?.abort(); jobs.current.delete(id);
    if (local) { commit(itemsRef.current.filter(entry => entry.id !== id)); return; }
    if (wasUploading) {
      // The server may have stored the file before the abort; withdraw it best-effort, it expires on its own otherwise.
      commit(itemsRef.current.filter(entry => entry.id !== id));
      void deleteSupervisorAttachment(conversation, id, new AbortController().signal).catch(() => undefined);
      return;
    }
    patch(id, { status: "removing", error: undefined });
    try { await deleteSupervisorAttachment(conversation, id, new AbortController().signal); commit(itemsRef.current.filter(entry => entry.id !== id)); }
    catch (error) { patch(id, { status: item.upload ? "staged" : "failed", error: `Not removed: ${failureText(error)}`, retryable: item.upload ? undefined : item.retryable }); }
  }, [conversation, commit, patch]);

  /** Forgets the list after its files are bound to an admitted message (they live with the message now). */
  const clear = useCallback(() => { for (const job of jobs.current.values()) job.abort(); jobs.current.clear(); commit([]); setNotice(null); }, [commit]);

  const staged = items.filter(item => item.status === "staged" && item.upload);
  const refs: AttachmentRef[] = staged.map(item => ({ id: item.id, digest: item.upload!.digest }));
  const blocked = items.some(item => item.status === "uploading" || item.status === "removing") ? "Wait for files to finish uploading before sending."
    : items.some(item => item.status === "failed") ? "Retry or remove files that did not upload before sending; they would not be included." : null;
  return { items, notice, refs, blocked, add, retry, remove, clear };
}
