import { ApiError, httpError } from "./client";
import { readBoundedBody } from "./responseBytes";

const ERROR_BODY_BYTES = 8192;

/** Only capacity and availability failures carry a retry hint. */
async function errorBody(response: Response): Promise<unknown> {
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) {
    void response.body?.cancel();
    return undefined;
  }
  try {
    const bytes = await readBoundedBody(response.body, ERROR_BODY_BYTES, () => new Error("Oversized error body"));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return undefined; }
}

async function terminalRequest(path: string, signal: AbortSignal, body: unknown): Promise<Response> {
  const request: RequestInit = {
    method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error",
    cache: "no-store", signal, headers: { Accept: "application/json" },
  };
  try {
    if (body !== undefined) {
      request.method = "POST";
      request.headers = { Accept: "application/json", "Content-Type": "application/json", "X-AQ-Request": "1" };
      request.body = JSON.stringify(body);
    }
    return await fetch(path, request);
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError("transport", "Terminal request could not reach AQ", { effectUnknown: body !== undefined });
  }
}

async function requireSuccess(response: Response) {
  if (response.ok) return;
  if (response.status === 429 || response.status >= 500) throw httpError(response, await errorBody(response));
  void response.body?.cancel();
  throw new ApiError("http", `AQ responded ${response.status}`, { status: response.status });
}

function serverClock(headers: Headers, body: ReadableStream): number {
  const stamp = headers.get("aq-terminal-server-time-ms");
  const value = stamp !== null && /^[0-9]{1,16}$/.test(stamp) ? Number(stamp) : NaN;
  if (Number.isSafeInteger(value) && value > 0) return value;
  void body.cancel();
  throw new ApiError("contract", "Missing terminal server clock anchor");
}

/** Finite terminal-local JSON, never automatically retry a Watch mutation. */
export async function terminalJson(path: string, signal: AbortSignal, body?: unknown): Promise<{ body: unknown; serverTime: number }> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const response = await terminalRequest(path, deadline, body);
  await requireSuccess(response);
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    throw new ApiError("contract", "Invalid terminal response");
  }
  const serverTime = serverClock(response.headers, response.body);
  const bytes = await readBoundedBody(response.body, 524288, () => new ApiError("contract", "Terminal response exceeds byte bound"));
  try {
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, serverTime };
  } catch {
    throw new ApiError("contract", "Invalid terminal JSON");
  }
}
