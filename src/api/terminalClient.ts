import { ApiError, httpError } from "./client";

const ERROR_BODY_BYTES = 8192;
/** A small error envelope, read only for capacity/unavailability answers so `retryable` can be honoured. */
async function errorBody(response: Response): Promise<unknown> {
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) { void response.body?.cancel(); return undefined; }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > ERROR_BODY_BYTES) return undefined; chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch { return undefined; }
  finally { void reader.cancel().catch(() => undefined); }
}

/** Finite terminal-local JSON, never automatically retry a Watch mutation. */
export async function terminalJson(path: string, signal: AbortSignal, body?: unknown): Promise<{ body: unknown; serverTime: number }> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let response: Response;
  try {
    response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "X-AQ-Request": "1" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError("transport", "Terminal request could not reach AQ", { effectUnknown: body !== undefined });
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw httpError(response, await errorBody(response));
    void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status });
  }
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) throw new ApiError("contract", "Invalid terminal response");
  const stamp = response.headers.get("aq-terminal-server-time-ms");
  const serverTime = stamp !== null && /^[0-9]{1,16}$/.test(stamp) ? Number(stamp) : NaN;
  if (!Number.isSafeInteger(serverTime) || serverTime <= 0) { void response.body.cancel(); throw new ApiError("contract", "Missing terminal server clock anchor"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 524288) throw new ApiError("contract", "Terminal response exceeds byte bound"); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, serverTime }; }
    catch { throw new ApiError("contract", "Invalid terminal JSON"); }
  } finally { void reader.cancel().catch(() => undefined); }
}
