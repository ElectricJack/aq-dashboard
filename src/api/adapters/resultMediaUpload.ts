import { canonicalUuid as uploadId, positiveInteger as stamp, sameFields } from "./contract";
export { uploadId };
import { MEDIA_CONTRACT, MEDIA_MAX, canonicalMedia, adaptResultMedia, mediaCheck, mediaDigest, mediaShape, sameMediaBinding, type MediaArtifact, type MediaBinding, type MediaLimits } from "./resultMedia";
export type UploadInput = { digest: string; bytes: number; filename: string };
export type UploadStatus = { contract: typeof MEDIA_CONTRACT; operation_id: string; actor_id: string; request_digest: string; binding: MediaBinding; input: UploadInput; capture: null; state: "reserved" | "received" | "finalizing" | "retained" | "rejected" | "expired"; created_at_ms: number; upload_expires_at_ms: number; retain_until_ms: number; recovery: { put_allowed: boolean; finalize_allowed: boolean; reason: string | null }; rejection: string | null; artifact: MediaArtifact | null; limits: MediaLimits };
export type FrozenUpload = { operation: string; actor: string; binding: MediaBinding; input: UploadInput; bytes: Uint8Array; raw: string | null; requestDigest: string };
const sha = (v: unknown): v is string => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
function filename(v: unknown): v is string { return typeof v === "string" && !!v.trim() && !/[\p{Cc}\p{Cs}\/\\]/u.test(v) && ![".", ".."].includes(v) && new TextEncoder().encode(v).length <= 256; }
function rawIntent(operation: string, input: UploadInput) { return JSON.stringify({ operation_id: operation, input_digest: input.digest, input_bytes: input.bytes, filename: input.filename, capture: null }); }
type UploadExpectation = { binding: MediaBinding; actor: string; operation: string; frozen?: FrozenUpload; requestDigest?: string; previous?: UploadStatus };
const FINAL_STATES = ["retained", "rejected", "expired"];
const INPUT_FIELDS = ["digest", "bytes", "filename"] as const;

function checkInput(input: unknown, limits: MediaLimits): asserts input is UploadInput {
  mediaShape(input, "digest bytes filename");
  mediaCheck(sha(input.digest));
  mediaCheck(stamp(input.bytes) && input.bytes <= limits.max_input_bytes);
  mediaCheck(filename(input.filename));
}

function checkRecovery(raw: Record<string, unknown>) {
  mediaShape(raw.recovery, "put_allowed finalize_allowed reason");
  const recovery = raw.recovery;
  mediaCheck(typeof recovery.put_allowed === "boolean");
  mediaCheck(typeof recovery.finalize_allowed === "boolean");
  if (recovery.reason !== null) mediaCheck(["busy", "expired", "rejected", "already_retained", "access_changed", "storage_changed", "clock_regression", "retry_budget_exhausted", "input_required"].includes(String(recovery.reason)));
  mediaCheck(["reserved", "received", "finalizing", ...FINAL_STATES].includes(String(raw.state)));
  mediaCheck((raw.state === "retained") === (raw.artifact !== null));
  mediaCheck((raw.state === "rejected") === (raw.rejection !== null));
  if (raw.rejection !== null) mediaCheck(["invalid_png", "unsupported_png", "input_mismatch", "pixel_limit", "processing_limit", "storage_failure"].includes(String(raw.rejection)));
  if (FINAL_STATES.includes(String(raw.state))) {
    mediaCheck(!recovery.put_allowed);
    mediaCheck(!recovery.finalize_allowed);
  }
  if (raw.state === "reserved") mediaCheck(!recovery.finalize_allowed);
  if (raw.state === "finalizing") mediaCheck(!recovery.put_allowed);
}

function checkPrevious(raw: Record<string, unknown>, input: UploadInput, previous: UploadStatus) {
  mediaCheck(raw.request_digest === previous.request_digest);
  mediaCheck(raw.created_at_ms === previous.created_at_ms);
  mediaCheck(raw.upload_expires_at_ms === previous.upload_expires_at_ms);
  mediaCheck(raw.retain_until_ms === previous.retain_until_ms);
  mediaCheck(canonicalMedia(raw.limits) === canonicalMedia(previous.limits));
  mediaCheck(sameFields(input, previous.input, INPUT_FIELDS));
  if (FINAL_STATES.includes(previous.state)) {
    mediaCheck(raw.state === previous.state);
    mediaCheck(raw.rejection === previous.rejection);
  }
  if (previous.artifact) {
    mediaShape(raw.artifact, "receipt receipt_digest availability");
    mediaCheck(raw.artifact.receipt_digest === previous.artifact.receipt_digest);
  }
}

async function checkRetainedArtifact(raw: UploadStatus, expected: MediaBinding) {
  if (raw.artifact === null) return;
  mediaShape(raw.artifact, "receipt receipt_digest availability");
  mediaShape(raw.artifact.availability, "state observed_at_ms reason");
  const page = await adaptResultMedia({
    contract: MEDIA_CONTRACT, server_time_ms: raw.artifact.availability.observed_at_ms,
    binding: raw.binding, limits: raw.limits, items: [raw.artifact],
  }, expected);
  const receipt = page.items[0]!.receipt;
  mediaCheck(receipt.artifact_id === raw.operation_id);
  mediaCheck(receipt.uploader_id === raw.actor_id);
  mediaCheck(receipt.capture === null);
  mediaCheck(sameFields(receipt.input, raw.input, INPUT_FIELDS));
  mediaCheck(receipt.retained_at_ms >= raw.created_at_ms);
  mediaCheck(receipt.retained_at_ms < raw.upload_expires_at_ms);
  mediaCheck(receipt.retain_until_ms === raw.retain_until_ms);
}

export async function adaptUploadStatus(raw: unknown, expected: UploadExpectation): Promise<UploadStatus> {
  mediaShape(raw, "contract operation_id actor_id request_digest binding input capture state created_at_ms upload_expires_at_ms retain_until_ms recovery rejection artifact limits");
  mediaCheck(raw.contract === MEDIA_CONTRACT);
  mediaCheck(uploadId(raw.operation_id) && raw.operation_id === expected.operation);
  mediaCheck(raw.actor_id === expected.actor && uploadId(raw.actor_id));
  mediaCheck(sha(raw.request_digest));
  mediaCheck(raw.capture === null);
  mediaCheck(stamp(raw.created_at_ms));
  mediaCheck(stamp(raw.upload_expires_at_ms));
  mediaCheck(stamp(raw.retain_until_ms));
  // Reuse the closed binding and limits validation with an empty item list.
  await adaptResultMedia({ contract: MEDIA_CONTRACT, server_time_ms: raw.created_at_ms, binding: raw.binding, limits: raw.limits, items: [] }, expected.binding);
  const limits = raw.limits as MediaLimits;
  if (expected.requestDigest) mediaCheck(raw.request_digest === expected.requestDigest);
  mediaCheck(raw.upload_expires_at_ms > raw.created_at_ms);
  mediaCheck(raw.upload_expires_at_ms - raw.created_at_ms <= limits.upload_ttl_ms);
  mediaCheck(raw.retain_until_ms > raw.upload_expires_at_ms);
  mediaCheck(raw.retain_until_ms - raw.created_at_ms <= limits.retention_ms);
  checkInput(raw.input, limits);
  checkRecovery(raw);
  if (expected.previous) checkPrevious(raw, raw.input, expected.previous);
  if (expected.frozen) {
    const f = expected.frozen;
    mediaCheck(f.operation === raw.operation_id);
    mediaCheck(f.actor === raw.actor_id);
    mediaCheck(sameMediaBinding(f.binding, expected.binding));
    mediaCheck(f.requestDigest === raw.request_digest);
    mediaCheck(sameFields(f.input, raw.input, INPUT_FIELDS));
  }
  const status = raw as unknown as UploadStatus;
  await checkRetainedArtifact(status, expected.binding);
  return status;
}

function pngChecksum(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checkPngHeader(bytes: Uint8Array): DataView {
  mediaCheck(bytes.length >= 45 && bytes.length <= MEDIA_MAX.max_input_bytes);
  mediaCheck([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  mediaCheck(width > 0 && height > 0);
  mediaCheck(Math.max(width, height) <= MEDIA_MAX.max_dimension);
  mediaCheck(width * height <= MEDIA_MAX.max_pixels);
  mediaCheck(bytes[24] === 8);
  mediaCheck([2, 6].includes(bytes[25]!));
  mediaCheck(bytes.subarray(26, 29).every(value => value === 0));
  return view;
}

type PngState = { first: boolean; idat: boolean; afterIdat: boolean; srgb: boolean; ended: boolean };

function checkChunkOrder(state: PngState, kind: string, payload: Uint8Array, last: boolean) {
  const length = payload.length;
  if (state.first) { mediaCheck(kind === "IHDR"); mediaCheck(length === 13); }
  else mediaCheck(kind !== "IHDR");
  state.first = false;
  if (kind === "sRGB") {
    mediaCheck(!state.srgb); mediaCheck(!state.idat); mediaCheck(length === 1);
    mediaCheck(payload[0]! <= 3);
    state.srgb = true;
  }
  if (kind === "IDAT") { mediaCheck(!state.afterIdat); state.idat = true; }
  else if (state.idat) state.afterIdat = true;
  if (kind === "IEND") {
    mediaCheck(length === 0);
    mediaCheck(state.idat);
    mediaCheck(last);
    state.ended = true;
  }
}

export function validateUploadPng(bytes: Uint8Array): void {
  const view = checkPngHeader(bytes);
  const state: PngState = { first: true, idat: false, afterIdat: false, srgb: false, ended: false };
  let offset = 8;
  while (offset < bytes.length) {
    mediaCheck(offset + 12 <= bytes.length);
    const length = view.getUint32(offset), end = offset + length + 12;
    mediaCheck(end <= bytes.length);
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    mediaCheck(["IHDR", "sRGB", "IDAT", "IEND"].includes(kind));
    mediaCheck(view.getUint32(end - 4) === pngChecksum(bytes.subarray(offset + 4, end - 4)));
    checkChunkOrder(state, kind, bytes.subarray(offset + 8, end - 4), end === bytes.length);
    offset = end;
  }
  mediaCheck(state.ended);
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
