import { ApiError } from "./client";
import type { EventsCursor } from "./adapters/sessionEvents";

/** Closed uint-only wire. Reject duplicate keys and lossy number syntax before JSON.parse. */
function document(text: string): unknown {
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"')) {
      if (/^\s*:/.test(text.slice(match.index + token.length))) {
        const keys = stack.at(-1), key: unknown = JSON.parse(token);
        if (!keys || typeof key !== "string" || keys.has(key)) throw new Error("Duplicate object key");
        keys.add(key);
      }
    } else if (!/^(0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) throw new Error("Unsupported numeric value");
  }
  return JSON.parse(text) as unknown;
}

/** One explicit bounded historical read, never a poll or content-byte request. */
export async function sessionEventsJson(attempt: string, cursor: EventsCursor, signal: AbortSignal): Promise<unknown> {
  const params = new URLSearchParams({ after_sequence: String(cursor.after), limit: "16" });
  if (cursor.through !== undefined) params.set("through_sequence", String(cursor.through));
  signal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let response: Response;
  try {
    response = await fetch(`/api/observations/sessions/${encodeURIComponent(attempt)}/events?${params}`, {
      method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("transport", "Session source events request could not reach AQ");
  }
  if (!response.ok) { void response.body?.cancel(); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); }
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    void response.body?.cancel(); throw new ApiError("contract", "Invalid session source events response");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 262144) throw new ApiError("contract", "Session source events exceed byte bound");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return document(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ApiError("contract", "Invalid session source events JSON"); }
  } finally { void reader.cancel().catch(() => undefined); }
}
