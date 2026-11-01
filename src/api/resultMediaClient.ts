import { ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { MEDIA_CONTRACT, MEDIA_MAX, mediaCheck, mediaDigest, mediaShape, sameMediaBinding, type MediaArtifact, type MediaBinding } from "./adapters/resultMedia";

export class MediaUnavailableError extends Error {
  override name = "MediaUnavailableError";
  constructor(readonly code: "media_expired" | "media_missing" | "media_withheld" | "media_failed") { super(code); }
}
export const resultMediaPath = (binding: MediaBinding) => `/api/human/results/${encodeURIComponent(binding.report_id)}/revisions/${encodeURIComponent(binding.report_revision)}/media`;
async function request(path: string, signal: AbortSignal): Promise<Response> {
  try { return await fetch(path, { method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal, headers: { Accept: "image/png, application/json" } }); }
  catch (error) { if (signal.aborted) throw error; throw new ApiError("transport", "Supplemental media could not reach AQ"); }
}
async function readBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new ContractError("Missing supplemental media response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maximum) throw new ContractError("Supplemental media exceeds byte bound"); chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
  } finally { void reader.cancel().catch(() => undefined); }
}
function json(bytes: Uint8Array): unknown { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ContractError("Invalid supplemental media JSON"); } }
function auth(response: Response) { if ([401, 403].includes(response.status)) { void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); } }
export async function resultMediaJson(binding: MediaBinding, signal: AbortSignal): Promise<unknown> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(6000)]); const response = await request(resultMediaPath(binding), signal); auth(response);
  if (!response.ok) { void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); }
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") { void response.body?.cancel(); throw new ContractError("Invalid supplemental media JSON type"); }
  return json(await readBytes(response, 262144));
}
/** Expected descriptor comes only from an independently report-bound, validated listing. */
export async function resultMediaBytes(binding: MediaBinding, artifact: MediaArtifact, variant: "preview" | "render", signal: AbortSignal): Promise<Uint8Array> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  mediaCheck((variant === "preview" || variant === "render") && sameMediaBinding(binding, artifact.receipt.binding));
  const expected = artifact.receipt.variants[variant];
  mediaCheck(artifact.availability.state === "available" && expected.mime === "image/png" && expected.bytes <= (variant === "preview" ? MEDIA_MAX.max_preview_bytes : MEDIA_MAX.max_render_bytes));
  const response = await request(`${resultMediaPath(binding)}/${encodeURIComponent(artifact.receipt.artifact_id)}/content?variant=${variant}`, signal); auth(response);
  if (!response.ok) {
    if ([404, 409, 410].includes(response.status) && response.headers.get("content-type")?.split(";")[0]?.trim() === "application/json") {
      let raw: unknown;
      try { raw = json(await readBytes(response, 4096)); } catch { throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); }
      if (!isRecord(raw) || raw.contract !== MEDIA_CONTRACT) throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status });
      mediaShape(raw, "contract error message");
      const statuses: Record<string, number> = { media_missing: 404, media_failed: 409, media_expired: 410, media_withheld: 410 };
      mediaCheck(raw.contract === MEDIA_CONTRACT && typeof raw.error === "string" && statuses[raw.error] === response.status && typeof raw.message === "string" && new TextEncoder().encode(raw.message).length <= 128 && !!raw.message.trim() && !/[\p{Cc}\p{Cs}]/u.test(raw.message));
      throw new MediaUnavailableError(raw.error as MediaUnavailableError["code"]);
    }
    void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status });
  }
  try {
    mediaCheck(response.status === 200 && response.headers.get("content-type") === "image/png" && response.headers.get("content-length") === String(expected.bytes));
    mediaCheck(response.headers.get("aq-media-digest") === expected.digest && response.headers.get("aq-media-receipt-digest") === artifact.receipt_digest);
    const bytes = await readBytes(response, expected.bytes);
    mediaCheck(bytes.length === expected.bytes && await mediaDigest(bytes) === expected.digest);
    // Bound browser decoding to the exact validated descriptor before any Blob URL exists.
    mediaCheck(bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    mediaCheck(view.getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR" && view.getUint32(16) === expected.width && view.getUint32(20) === expected.height);
    mediaCheck(bytes[24] === 8 && bytes[25] === 6 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0);
    signal.throwIfAborted(); return bytes;
  } finally { if (!response.bodyUsed) void response.body?.cancel().catch(() => undefined); }
}
