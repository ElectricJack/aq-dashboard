import { ApiError } from "./client";
import { catalogUrl, type CatalogKind, type CatalogRequest } from "./adapters/playbookCatalog";
const MAX_BYTES = 262144;
/** Closed catalog wire has only unsigned safe numeric clocks; revisions are strings. */
function document(text: string): unknown {
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === "{") stack.push(new Set()); else if (token === "[") stack.push(null); else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"')) {
      let after = match.index + token.length; while (after < text.length && /\s/.test(text[after]!)) after++;
      if (text[after] === ":") { const keys = stack.at(-1), key: unknown = JSON.parse(token); if (!keys || typeof key !== "string" || keys.has(key)) throw new Error("Duplicate object key"); keys.add(key); }
    } else if (!/^(0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) throw new Error("Unsupported numeric value");
  }
  return JSON.parse(text) as unknown;
}
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
/** Feature-local finite read. Never parse an error body before authorization denial. */
export async function playbookCatalogJson(kind: CatalogKind, project: string | null, request: CatalogRequest, signal: AbortSignal): Promise<unknown> {
  const deadline = new AbortController(), joined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new DOMException("Catalog request timed out", "TimeoutError")), 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined;
  try {
    joined.throwIfAborted();
    const pending = fetch(catalogUrl(kind, project, request), { method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", signal: joined, headers: { Accept: "application/json" } });
    void pending.then(late => { if (joined.aborted) void late.body?.cancel().catch(() => undefined); }, () => undefined);
    try { response = await untilAbort(pending, joined); }
    catch (error) { if (joined.aborted) throw error; throw new ApiError("transport", "Current playbook catalog could not reach AQ"); }
    // Classification happens at headers, including a held or never-ending body.
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status }); }
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" || !response.body) throw new ApiError("contract", "Invalid current playbook catalog response");
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await untilAbort(reader.read(), joined); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new ApiError("contract", "Current playbook catalog exceeds byte bound"); chunks.push(value); }
    joined.throwIfAborted(); const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return document(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ApiError("contract", "Invalid current playbook catalog JSON"); }
  } finally {
    clearTimeout(timer); deadline.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else if (response && !response.bodyUsed) void response.body?.cancel().catch(() => undefined);
  }
}
