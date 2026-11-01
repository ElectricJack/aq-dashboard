import { ApiError } from "./client";

/** Finite, same-origin inspection only. Never persist or poll an accounting view. */
export async function sessionUsageJson(attempt: string, signal: AbortSignal): Promise<unknown> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let response: Response;
  try {
    response = await fetch(`/api/observations/sessions/${encodeURIComponent(attempt)}/usage`, {
      method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("transport", "Session usage request could not reach AQ");
  }
  if (!response.ok) { void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); }
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    void response.body?.cancel(); throw new ApiError("contract", "Invalid session usage response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16384) throw new ApiError("contract", "Session usage exceeds byte bound");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new ApiError("contract", "Invalid session usage JSON"); }
  } finally { void reader.cancel().catch(() => undefined); }
}
