import { parseUnsignedJson } from "./unsignedJson";
import { collectResponseBytes } from "./responseBytes";
import { ApiError } from "./client";
import { catalogUrl, type CatalogKind, type CatalogRequest } from "./adapters/playbookCatalog";
const MAX_BYTES = 262144;
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
async function requestCatalog(path: string, signal: AbortSignal): Promise<Response> {
  const pending = fetch(path, {
    method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store",
    signal, headers: { Accept: "application/json" },
  });
  void pending.then(response => {
    if (signal.aborted) void response.body?.cancel().catch(() => undefined);
  }, () => undefined);
  try { return await untilAbort(pending, signal); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError("transport", "Current playbook catalog could not reach AQ");
  }
}

function catalogReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  // Refusals are classified at headers, even when the body never finishes.
  if (!response.ok) throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status });
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json" || !response.body) throw new ApiError("contract", "Invalid current playbook catalog response");
  return response.body.getReader();
}

async function readCatalog(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<unknown> {
  const bytes = await collectResponseBytes(
    () => untilAbort(reader.read(), signal), MAX_BYTES,
    () => new ApiError("contract", "Current playbook catalog exceeds byte bound"),
  );
  signal.throwIfAborted();
  try { return parseUnsignedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError("contract", "Invalid current playbook catalog JSON"); }
}

/** Feature-local finite read. Never parse an error body before authorization denial. */
export async function playbookCatalogJson(kind: CatalogKind, project: string | null, request: CatalogRequest, signal: AbortSignal): Promise<unknown> {
  const deadline = new AbortController();
  const joined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new DOMException("Catalog request timed out", "TimeoutError")), 5000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    joined.throwIfAborted();
    response = await requestCatalog(catalogUrl(kind, project, request), joined);
    reader = catalogReader(response);
    return await readCatalog(reader, joined);
  } finally {
    clearTimeout(timer);
    deadline.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else if (response && !response.bodyUsed) void response.body?.cancel().catch(() => undefined);
  }
}
