import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentCapability } from "../../api/adapters/supervisor";
import { AttachmentRequestError } from "../../api/supervisorAttachmentClient";
import { storeFile, withdraw, discard, failureText } from "./attachmentTransfer";
import { pendingFile, hasUpload, localOnly, limitMessage, uploadRefs, blockedReason, type PendingAttachment } from "./pendingAttachments";
export { ATTACHMENT_TYPE_LABEL, attachmentAccept, classifyAttachment, formatBytes } from "./attachmentFiles";
export type { AttachmentStatus, PendingAttachment } from "./pendingAttachments";

type FileUpload = PendingAttachment & { file: File; mediaType: string };

function useAttachmentList(conversation: string | undefined) {
  const [items, setItems] = useState<PendingAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<PendingAttachment[]>([]);
  const jobs = useRef(new Map<string, AbortController>());
  const active = useRef(true);
  const commit = useCallback((next: PendingAttachment[]) => {
    itemsRef.current = next;
    if (active.current) setItems(next);
  }, []);
  const patch = useCallback((id: string, change: Partial<PendingAttachment>) => {
    commit(itemsRef.current.map(item => item.id === id ? { ...item, ...change } : item));
  }, [commit]);
  const forget = useCallback((id: string) => commit(itemsRef.current.filter(item => item.id !== id)), [commit]);
  const abortAll = useCallback(() => {
    for (const owner of jobs.current.values()) owner.abort();
    jobs.current.clear();
  }, []);
  const clear = useCallback(() => {
    abortAll();
    commit([]);
    setNotice(null);
  }, [abortAll, commit]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; abortAll(); };
  }, [abortAll]);
  useEffect(clear, [conversation, clear]);
  return { items, itemsRef, jobs, notice, setNotice, commit, patch, forget, clear };
}

function useFileTransfer(conversation: string | undefined, { jobs, patch }: ReturnType<typeof useAttachmentList>) {
  return useCallback(async ({ id, file, mediaType }: FileUpload) => {
    if (!conversation) return;
    const owner = new AbortController();
    jobs.current.set(id, owner);
    patch(id, { status: "uploading", error: undefined, retryable: undefined });
    try {
      const upload = await storeFile({ conversation, id, file, mediaType, signal: owner.signal });
      if (!owner.signal.aborted) patch(id, { status: "staged", upload });
    } catch (error) {
      if (!owner.signal.aborted) patch(id, { status: "failed", error: failureText(error), retryable: error instanceof AttachmentRequestError ? error.retryable : true });
    } finally {
      if (jobs.current.get(id) === owner) jobs.current.delete(id);
    }
  }, [conversation, jobs, patch]);
}

function removalFailure(item: PendingAttachment, reason: unknown): Partial<PendingAttachment> {
  const error = `Not removed: ${failureText(reason)}`;
  if (item.upload) return { status: "staged", error, retryable: undefined };
  return { status: "failed", error, retryable: item.retryable };
}

function useRemoveAttachment(conversation: string | undefined, { itemsRef, jobs, patch, forget }: ReturnType<typeof useAttachmentList>) {
  return useCallback(async (id: string) => {
    const item = itemsRef.current.find(candidate => candidate.id === id);
    if (!conversation || !item) return;
    if (item.status === "removing") return;
    jobs.current.get(id)?.abort();
    jobs.current.delete(id);
    if (localOnly(item)) return forget(id);
    if (item.status === "uploading") {
      // The server might have stored the file before learning of the abort.
      forget(id);
      discard(conversation, id);
      return;
    }
    patch(id, { status: "removing", error: undefined });
    try {
      await withdraw(conversation, id);
      forget(id);
    } catch (error) {
      patch(id, removalFailure(item, error));
    }
  }, [conversation, itemsRef, jobs, patch, forget]);
}

type FileLimits = { conversation?: string; capability?: AttachmentCapability; maxFiles: number };
function useAddFiles({ conversation, capability, maxFiles }: FileLimits, list: ReturnType<typeof useAttachmentList>, upload: ReturnType<typeof useFileTransfer>) {
  const { itemsRef, commit, setNotice } = list;
  return useCallback((files: Iterable<File>) => {
    if (!conversation || !capability) return;
    const messages: string[] = [];
    for (const file of files) {
      if (itemsRef.current.filter(item => !localOnly(item)).length >= maxFiles) {
        messages.push(limitMessage(file, maxFiles));
        continue;
      }
      const item = pendingFile(file, capability);
      commit([...itemsRef.current, item]);
      if (hasUpload(item)) void upload(item);
    }
    setNotice(messages.join(" ") || null);
  }, [conversation, capability, maxFiles, commit, upload, itemsRef, setNotice]);
}

/** Stages picked files for the next message and keeps failed files available for retry or removal. */
export function useSupervisorAttachments(conversation: string | undefined, capability: AttachmentCapability | undefined, maxFiles: number) {
  const list = useAttachmentList(conversation);
  const { items, itemsRef, notice, clear } = list;
  const upload = useFileTransfer(conversation, list);
  const remove = useRemoveAttachment(conversation, list);
  const add = useAddFiles({ conversation, capability, maxFiles }, list, upload);
  const retry = useCallback((id: string) => {
    const item = itemsRef.current.find(candidate => candidate.id === id);
    if (item?.status !== "failed" || !item.retryable) return;
    if (hasUpload(item)) void upload(item);
  }, [itemsRef, upload]);
  return { items, notice, refs: uploadRefs(items), blocked: blockedReason(items), add, retry, remove, clear };
}
