import { validAttachmentName, type AttachmentCapability } from "../../api/adapters/supervisor";
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
type FileInfo = Pick<File, "name" | "size" | "type">;
function allowedType(file: FileInfo, types: readonly string[]) {
  const declared = file.type.toLowerCase();
  if (types.includes(declared)) return declared;
  if (declared && declared !== "application/octet-stream") return;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return;
  return EXTENSION_TYPES[file.name.slice(dot + 1).toLowerCase()];
}

/** The media type to upload, or the reason this file cannot be attached. Nothing here is silently dropped. */
export function classifyAttachment(file: FileInfo, capability: AttachmentCapability): { mediaType: string } | { error: string } {
  if (!validAttachmentName(file.name) || utf8Bytes(file.name) > capability.max_name_bytes) return { error: `The file name is not accepted (use a plain name of at most ${capability.max_name_bytes} bytes, without slashes or control characters).` };
  if (file.size === 0) return { error: "The file is empty, so there is nothing to review." };
  if (file.size > capability.max_file_bytes) return { error: `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(capability.max_file_bytes)}.` };
  const mediaType = allowedType(file, capability.media_types);
  if (!mediaType || !(capability.media_types as string[]).includes(mediaType)) return { error: `This file type is not supported. Attach ${capability.media_types.map(t => ATTACHMENT_TYPE_LABEL[t] ?? t).join(", ")} files.` };
  return { mediaType };
}
