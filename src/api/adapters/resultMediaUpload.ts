import { MEDIA_CONTRACT, MEDIA_MAX, canonicalMedia, adaptResultMedia, mediaCheck, mediaDigest, mediaShape, sameMediaBinding, type MediaArtifact, type MediaBinding, type MediaLimits } from "./resultMedia";
export type UploadInput = { digest: string; bytes: number; filename: string };
export type UploadStatus = { contract: typeof MEDIA_CONTRACT; operation_id: string; actor_id: string; request_digest: string; binding: MediaBinding; input: UploadInput; capture: null; state: "reserved" | "received" | "finalizing" | "retained" | "rejected" | "expired"; created_at_ms: number; upload_expires_at_ms: number; retain_until_ms: number; recovery: { put_allowed: boolean; finalize_allowed: boolean; reason: string | null }; rejection: string | null; artifact: MediaArtifact | null; limits: MediaLimits };
export type FrozenUpload = { operation: string; actor: string; binding: MediaBinding; input: UploadInput; bytes: Uint8Array; raw: string | null; requestDigest: string };
export const uploadId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
const sha = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const stamp = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
function filename(v: unknown): v is string { return typeof v === "string" && !!v.trim() && !/[\p{Cc}\p{Cs}\/\\]/u.test(v) && ![".", ".."].includes(v) && new TextEncoder().encode(v).length <= 256; }
function rawIntent(operation: string, input: UploadInput) { return JSON.stringify({ operation_id: operation, input_digest: input.digest, input_bytes: input.bytes, filename: input.filename, capture: null }); }
export async function adaptUploadStatus(raw: unknown, expected: { binding: MediaBinding; actor: string; operation: string; frozen?: FrozenUpload; requestDigest?: string; previous?: UploadStatus }): Promise<UploadStatus> {
  mediaShape(raw, "contract operation_id actor_id request_digest binding input capture state created_at_ms upload_expires_at_ms retain_until_ms recovery rejection artifact limits");
  mediaCheck(raw.contract === MEDIA_CONTRACT && uploadId(raw.operation_id) && raw.operation_id === expected.operation && raw.actor_id === expected.actor && uploadId(raw.actor_id) && sha(raw.request_digest) && raw.capture === null);
  mediaCheck(stamp(raw.created_at_ms) && stamp(raw.upload_expires_at_ms) && stamp(raw.retain_until_ms));
  // Reuse the closed binding/limits validator; this synthetic envelope is validation only,
  // not an observed MediaPage or authority for the independently pinned report.
  await adaptResultMedia({ contract: MEDIA_CONTRACT, server_time_ms: raw.created_at_ms, binding: raw.binding, limits: raw.limits, items: [] }, expected.binding);
  const limits = raw.limits as MediaLimits;
  if (expected.requestDigest) mediaCheck(raw.request_digest === expected.requestDigest);
  if (expected.previous) { const previous = expected.previous; mediaCheck(raw.request_digest === previous.request_digest && raw.created_at_ms === previous.created_at_ms && raw.upload_expires_at_ms === previous.upload_expires_at_ms && raw.retain_until_ms === previous.retain_until_ms && canonicalMedia(raw.limits) === canonicalMedia(previous.limits)); }
  mediaCheck(raw.upload_expires_at_ms > raw.created_at_ms && raw.upload_expires_at_ms - raw.created_at_ms <= limits.upload_ttl_ms && raw.retain_until_ms > raw.upload_expires_at_ms && raw.retain_until_ms - raw.created_at_ms <= limits.retention_ms);
  mediaShape(raw.input, "digest bytes filename"); mediaCheck(sha(raw.input.digest) && typeof raw.input.bytes === "number" && Number.isSafeInteger(raw.input.bytes) && raw.input.bytes > 0 && raw.input.bytes <= limits.max_input_bytes && filename(raw.input.filename));
  mediaShape(raw.recovery, "put_allowed finalize_allowed reason");
  mediaCheck(typeof raw.recovery.put_allowed === "boolean" && typeof raw.recovery.finalize_allowed === "boolean" && (raw.recovery.reason === null || ["busy", "expired", "rejected", "already_retained", "access_changed", "storage_changed", "clock_regression", "retry_budget_exhausted", "input_required"].includes(String(raw.recovery.reason))));
  mediaCheck(["reserved", "received", "finalizing", "retained", "rejected", "expired"].includes(String(raw.state)));
  mediaCheck((raw.state === "retained") === (raw.artifact !== null) && (raw.state === "rejected") === (raw.rejection !== null));
  if (raw.rejection !== null) mediaCheck(["invalid_png", "unsupported_png", "input_mismatch", "pixel_limit", "processing_limit", "storage_failure"].includes(String(raw.rejection)));
  if (["retained", "rejected", "expired"].includes(String(raw.state))) mediaCheck(!raw.recovery.put_allowed && !raw.recovery.finalize_allowed);
  if (raw.state === "reserved") mediaCheck(!raw.recovery.finalize_allowed);
  if (raw.state === "finalizing") mediaCheck(!raw.recovery.put_allowed);
  if (expected.previous) {
    const previous = expected.previous; mediaCheck(raw.input.digest === previous.input.digest && raw.input.bytes === previous.input.bytes && raw.input.filename === previous.input.filename);
    if (["retained", "rejected", "expired"].includes(previous.state)) mediaCheck(raw.state === previous.state && raw.rejection === previous.rejection);
    if (previous.artifact) { mediaShape(raw.artifact, "receipt receipt_digest availability"); mediaCheck(raw.artifact.receipt_digest === previous.artifact.receipt_digest); }
  }
  if (expected.frozen) {
    const f = expected.frozen; mediaCheck(f.operation === raw.operation_id && f.actor === raw.actor_id && sameMediaBinding(f.binding, expected.binding) && f.requestDigest === raw.request_digest);
    mediaCheck(f.input.digest === raw.input.digest && f.input.bytes === raw.input.bytes && f.input.filename === raw.input.filename);
  }
  if (raw.artifact !== null) {
    mediaShape(raw.artifact, "receipt receipt_digest availability"); mediaShape(raw.artifact.availability, "state observed_at_ms reason");
    const page = await adaptResultMedia({ contract: MEDIA_CONTRACT, server_time_ms: raw.artifact.availability.observed_at_ms, binding: raw.binding, limits, items: [raw.artifact] }, expected.binding);
    const receipt = page.items[0]!.receipt;
    mediaCheck(receipt.artifact_id === raw.operation_id && receipt.uploader_id === raw.actor_id && receipt.capture === null && receipt.input.digest === raw.input.digest && receipt.input.bytes === raw.input.bytes && receipt.input.filename === raw.input.filename && receipt.retained_at_ms >= raw.created_at_ms && receipt.retained_at_ms < raw.upload_expires_at_ms && receipt.retain_until_ms === raw.retain_until_ms);
  }
  return raw as unknown as UploadStatus;
}
export function validateUploadPng(bytes: Uint8Array): void {
  mediaCheck(bytes.length >= 45 && bytes.length <= MEDIA_MAX.max_input_bytes && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  mediaCheck(width > 0 && height > 0 && Math.max(width, height) <= MEDIA_MAX.max_dimension && width * height <= MEDIA_MAX.max_pixels && bytes[24] === 8 && [2, 6].includes(bytes[25]!) && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0);
  let offset = 8, first = true, idat = false, afterIdat = false, srgb = false, ended = false;
  while (offset < bytes.length) {
    mediaCheck(offset + 12 <= bytes.length); const length = view.getUint32(offset), end = offset + length + 12;
    mediaCheck(end <= bytes.length); const kind = String.fromCharCode(...bytes.slice(offset + 4, offset + 8)); mediaCheck(["IHDR", "sRGB", "IDAT", "IEND"].includes(kind));
    let crc = 0xffffffff; for (const value of bytes.subarray(offset + 4, end - 4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    mediaCheck(view.getUint32(end - 4) === ((crc ^ 0xffffffff) >>> 0));
    if (first) mediaCheck(kind === "IHDR" && length === 13); else mediaCheck(kind !== "IHDR"); first = false;
    if (kind === "sRGB") { mediaCheck(!srgb && !idat && length === 1 && bytes[offset + 8]! <= 3); srgb = true; }
    if (kind === "IDAT") { mediaCheck(!afterIdat); idat = true; } else if (idat) afterIdat = true;
    if (kind === "IEND") { mediaCheck(length === 0 && idat && end === bytes.length); ended = true; }
    offset = end;
  }
  mediaCheck(ended);
}
async function fileBytes(file: File): Promise<Uint8Array> {
  mediaCheck(file.size > 0 && file.size <= MEDIA_MAX.max_input_bytes && (!file.type || file.type === "image/png"));
  const bytes = new Uint8Array(await file.arrayBuffer()); mediaCheck(bytes.length === file.size); validateUploadPng(bytes); return bytes;
}
export async function freezeUpload(file: File, binding: MediaBinding, actor: string, reference?: { operation: string; requestDigest: string }): Promise<FrozenUpload> {
  mediaCheck(uploadId(actor) && filename(file.name)); const bytes = await fileBytes(file), operation = reference?.operation ?? crypto.randomUUID(); mediaCheck(uploadId(operation));
  const input = { digest: await mediaDigest(bytes), bytes: bytes.length, filename: file.name }, raw = rawIntent(operation, input);
  const requestDigest = await mediaDigest(new TextEncoder().encode(raw)); if (reference) mediaCheck(requestDigest === reference.requestDigest);
  return { operation, actor, binding, input, bytes, raw, requestDigest };
}
export async function reselectUpload(file: File, status: UploadStatus): Promise<FrozenUpload> {
  const bytes = await fileBytes(file); mediaCheck(bytes.length === status.input.bytes && await mediaDigest(bytes) === status.input.digest);
  const raw = rawIntent(status.operation_id, status.input), reconstructed = await mediaDigest(new TextEncoder().encode(raw));
  return { operation: status.operation_id, actor: status.actor_id, binding: status.binding, input: status.input, bytes, raw: reconstructed === status.request_digest ? raw : null, requestDigest: status.request_digest };
}
