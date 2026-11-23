import { useRef } from "react";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import type { AttachmentCapability, AttachmentDescriptor } from "../../api/adapters/supervisor";
import { Icon } from "../../components/icons";
import { ATTACHMENT_TYPE_LABEL, attachmentAccept, formatBytes, type PendingAttachment } from "./useSupervisorAttachments";
import styles from "./SupervisorConversation.module.css";

const typeLabel = (type: string | null) => (type && ATTACHMENT_TYPE_LABEL[type]) || "File";
const STATUS_TEXT = { uploading: "Uploading…", staged: "Ready to send", failed: "Not attached", removing: "Removing…" } as const;

/** Picker button and the bounded hint beside it. The button only opens the browser's file chooser. */
export function AttachmentPicker({ capability, maxFiles, disabled, onFiles }: { capability: AttachmentCapability; maxFiles: number; disabled: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <span className={styles.attachControl}>
    <button type="button" className={styles.attachButton} disabled={disabled} onClick={() => input.current?.click()}><Icon icon={Paperclip} size={18} /><span>Attach file</span></button>
    <input ref={input} type="file" multiple hidden tabIndex={-1} aria-label="Choose files to attach" accept={attachmentAccept(capability)} disabled={disabled}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) onFiles(files); }} />
    <span className={styles.attachHint}><span className={styles.fullControl}>Up to {maxFiles} file{maxFiles === 1 ? "" : "s"} · {formatBytes(capability.max_file_bytes)} each · {capability.media_types.map(t => typeLabel(t)).join(", ")}</span><span className={styles.compactControl}>Up to {maxFiles} · {formatBytes(capability.max_file_bytes)} each</span></span>
  </span>;
}

/** Files chosen for the next message: name, upload status, retry for recoverable failures and removal until the message is sent. */
type AttachmentActions = { locked: boolean; onRetry: (id: string) => void; onRemove: (id: string) => void };

function PendingFile({ item, locked, onRetry, onRemove }: AttachmentActions & { item: PendingAttachment }) {
  return <li data-status={item.status}>
      <span className={styles.fileName} title={item.name}>{item.name}</span>
      <span className={styles.fileMeta}>{typeLabel(item.mediaType)} · {formatBytes(item.size)}</span>
      <span className={styles.fileStatus} role="status">{item.status === "uploading" || item.status === "removing" ? <Icon icon={LoaderCircle} size={14} /> : null}{STATUS_TEXT[item.status]}</span>
      {item.error && <span className={styles.fileError} role="alert">{item.error}</span>}
      <span className={styles.fileActions}>
        {item.status === "failed" && item.retryable && <button type="button" disabled={locked} onClick={() => onRetry(item.id)}>Retry<span className="visually-hidden"> upload of {item.name}</span></button>}
        <button type="button" disabled={locked || item.status === "removing"} aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}><Icon icon={X} size={16} /></button>
      </span>
    </li>;
}

export function PendingAttachments({ items, notice, locked, onRetry, onRemove }: AttachmentActions & { items: PendingAttachment[]; notice: string | null }) {
  if (!items.length && !notice) return null;
  return <div className={styles.pendingFiles}>
    {items.length > 0 && <ul aria-label="Attachments to send">{items.map(item => <PendingFile key={item.id} item={item} locked={locked} onRetry={onRetry} onRemove={onRemove} />)}</ul>}
    {notice && <p role="alert" className={styles.fileError}>{notice}</p>}
  </div>;
}

/** The files a retained message carries, shown from its history descriptors. */
export function MessageAttachments({ attachments }: { attachments: readonly AttachmentDescriptor[] }) {
  if (!attachments.length) return null;
  return <ul className={styles.messageFiles} aria-label="Message attachments">{attachments.map(file => <li key={file.id}>
    <Icon icon={Paperclip} size={14} /><span className={styles.fileName} title={file.name}>{file.name}</span><span className={styles.fileMeta}>{typeLabel(file.media_type)} · {formatBytes(file.size_bytes)}</span>
  </li>)}</ul>;
}
