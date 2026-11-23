import { ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { resultMediaPath } from "./resultMediaClient";
import { uploadId, type FrozenUpload } from "./adapters/resultMediaUpload";
import { mediaCheck } from "./adapters/resultMedia";
import { readBoundedBody, rejectResponse, hasJsonMediaType } from "./responseBytes";

export type UploadAction = "lookup" | "create" | "put" | "finalize";
const responseStatuses: Record<UploadAction, number[]> = {
  lookup: [200], create: [200, 201], put: [200, 202, 410, 422], finalize: [200, 202, 409, 410, 422],
};

function uploadPath(action: UploadAction, operation: string, frozen?: FrozenUpload): string {
  mediaCheck(uploadId(operation));
  const base = `/api/human/result-media-uploads/${encodeURIComponent(operation)}`;
  switch (action) {
    case "create":
      mediaCheck(frozen?.operation === operation);
      mediaCheck(frozen.raw !== null);
      return `${resultMediaPath(frozen.binding)}-uploads`;
    case "put":
      mediaCheck(frozen?.operation === operation);
      return `${base}/content`;
    case "finalize": return `${base}/finalize`;
    case "lookup": return base;
  }
}

function requestInit(action: UploadAction, signal: AbortSignal, frozen?: FrozenUpload): RequestInit {
  const headers = new Headers({ Accept: "application/json" });
  const common = { headers, signal, credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store" } as const;
  if (action === "lookup") return { ...common, method: "GET" };
  headers.set("X-AQ-Request", "1");
  if (action === "put") {
    headers.set("Content-Type", "image/png");
    return { ...common, method: "PUT", body: Uint8Array.from(frozen!.bytes) };
  }
  headers.set("Content-Type", "application/json");
  return { ...common, method: "POST", body: action === "create" ? frozen!.raw! : "{}" };
}

function unknownStatus(response: Response, action: UploadAction) {
  return new ApiError("http", "Upload status is unknown", { status: response.status, effectUnknown: action !== "lookup" });
}

function uploadBody(response: Response, action: UploadAction): ReadableStream<Uint8Array> {
  if ([401, 403].includes(response.status)) {
    rejectResponse(response, new ApiError("http", "Upload access denied", { status: response.status }));
  }
  if (!responseStatuses[action].includes(response.status)) {
    rejectResponse(response, unknownStatus(response, action));
  }
  if (!hasJsonMediaType(response) || !response.body) {
    rejectResponse(response, new ContractError("Invalid upload status response"));
  }
  return response.body;
}

function parseUpload(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ContractError("Invalid upload status JSON"); }
}

function unboundError(value: unknown) {
  if (!isRecord(value) || value.contract !== undefined) return false;
  return [value.error, value.message].every(field => typeof field === "string");
}

async function fetchUpload(path: string, action: UploadAction, deadline: AbortSignal, frozen?: FrozenUpload): Promise<Response> {
  try { return await fetch(path, requestInit(action, deadline, frozen)); }
  catch (error) {
    if (deadline.aborted) throw error;
    throw new ApiError("transport", "Upload status is unknown", { effectUnknown: action !== "lookup" });
  }
}

export async function uploadRequest(action: UploadAction, operation: string, signal: AbortSignal, frozen?: FrozenUpload): Promise<unknown> {
  const path = uploadPath(action, operation, frozen);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(action === "put" ? 15000 : 10000)]);
  const response = await fetchUpload(path, action, deadline, frozen);
  const bytes = await readBoundedBody(uploadBody(response, action), 262144, () => new ContractError("Upload response exceeds limit"));
  deadline.throwIfAborted();
  const value = parseUpload(bytes);
  if (!response.ok && unboundError(value)) throw unknownStatus(response, action);
  return value;
}
