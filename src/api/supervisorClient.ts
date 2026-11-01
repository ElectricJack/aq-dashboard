import { ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
/** Text mailbox requests only; POST ambiguity never permits a replacement intent. */
export async function supervisorRequest(method: "GET" | "POST", path: string, signal: AbortSignal, bytes?: string): Promise<unknown> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  let response: Response;
  try {
    response = await fetch(path, { method, signal, credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json", "X-AQ-Request": "1" } : {}) }, ...(bytes === undefined ? {} : { body: bytes }) });
  } catch { throw new ApiError("transport", "Global supervisor response was not received", { effectUnknown: method === "POST" }); }
  if (!response.ok && response.status !== 409) { void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status, effectUnknown: method === "POST" }); }
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) { void response.body?.cancel(); throw new ContractError("Invalid global supervisor response"); }
  const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 262144) throw new ContractError("Global supervisor response exceeds byte bound"); chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let raw: unknown; try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ContractError("Invalid global supervisor JSON"); }
    if (response.status === 409 && !(method === "POST" && isRecord(raw) && raw.contract === "human-supervisor-conversation-1" && raw.state === "not_queued")) throw new ApiError("http", "AQ responded 409 without a retained receipt", { status: 409, effectUnknown: method === "POST" });
    if (method === "POST" && response.status === 200 && !(isRecord(raw) && raw.contract === "human-supervisor-conversation-1" && raw.state === "queued")) throw new ContractError("Invalid supervisor admission disposition");
    return raw;
  } finally { void reader.cancel().catch(() => undefined); }
}
