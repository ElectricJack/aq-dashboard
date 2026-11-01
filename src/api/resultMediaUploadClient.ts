import { ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { resultMediaPath } from "./resultMediaClient";
import { uploadId, type FrozenUpload } from "./adapters/resultMediaUpload";
import { mediaCheck } from "./adapters/resultMedia";
export type UploadAction = "lookup" | "create" | "put" | "finalize";
export async function uploadRequest(action: UploadAction, operation: string, signal: AbortSignal, frozen?: FrozenUpload): Promise<unknown> {
  mediaCheck(uploadId(operation));
  if (action === "create" || action === "put") mediaCheck(!!frozen && frozen.operation === operation && (action !== "create" || frozen.raw !== null));
  const base = `/api/human/result-media-uploads/${encodeURIComponent(operation)}`;
  const path = action === "create" ? `${resultMediaPath(frozen!.binding)}-uploads` : action === "put" ? `${base}/content` : action === "finalize" ? `${base}/finalize` : base;
  const method = action === "lookup" ? "GET" : action === "put" ? "PUT" : "POST";
  signal = AbortSignal.any([signal, AbortSignal.timeout(action === "put" ? 15000 : 10000)]);
  const headers = new Headers({ Accept: "application/json" });
  if (method !== "GET") { headers.set("X-AQ-Request", "1"); headers.set("Content-Type", action === "put" ? "image/png" : "application/json"); }
  let response: Response;
  try { response = await fetch(path, { method, headers, credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal, ...(method !== "GET" ? { body: action === "put" ? Uint8Array.from(frozen!.bytes) : action === "create" ? frozen!.raw! : "{}" } : {}) }); }
  catch (error) { if (signal.aborted) throw error; throw new ApiError("transport", "Upload status is unknown", { effectUnknown: method !== "GET" }); }
  if ([401, 403].includes(response.status)) { void response.body?.cancel(); throw new ApiError("http", "Upload access denied", { status: response.status }); }
  const statuses = action === "lookup" ? [200] : action === "create" ? [200, 201] : action === "put" ? [200, 202, 410, 422] : [200, 202, 409, 410, 422];
  if (!statuses.includes(response.status)) { void response.body?.cancel(); throw new ApiError("http", "Upload status is unknown", { status: response.status, effectUnknown: method !== "GET" }); }
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" || !response.body) { void response.body?.cancel(); throw new ContractError("Invalid upload status response"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 262144) throw new ContractError("Upload response exceeds limit"); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    signal.throwIfAborted(); let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ContractError("Invalid upload status JSON"); }
    if (!response.ok && isRecord(raw) && typeof raw.error === "string" && typeof raw.message === "string" && raw.contract === undefined) throw new ApiError("http", "Upload status is unknown", { status: response.status, effectUnknown: method !== "GET" });
    return raw;
  } finally { void reader.cancel().catch(() => undefined); }
}
