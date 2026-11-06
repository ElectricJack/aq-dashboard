import { ContractError, isRecord } from "./adapters/contract";
import type { ErrorEnvelope } from "./wire/proposed";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiErrorKind = "http" | "transport" | "contract";

/**
 * `transport` errors on mutations leave the effect unknown: the request may
 * have been admitted. Callers must reconcile, never assume failure.
 */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly details: {
      status?: number;
      envelope?: ErrorEnvelope;
      effectUnknown?: boolean;
      /** Server-requested wait before a retry (`Retry-After` or `retry_after_ms`). */
      retryAfterMs?: number;
    } = {},
  ) {
    super(message);
  }
  get status() {
    return this.details.status;
  }
  get envelope() {
    return this.details.envelope;
  }
  get effectUnknown() {
    return this.details.effectUnknown ?? false;
  }
  get retryAfterMs() {
    return this.details.retryAfterMs ?? this.details.envelope?.retry_after_ms;
  }
}

const MAX_RETRY_AFTER_MS = 60_000;

/** `Retry-After` as delta-seconds or an HTTP date, bounded so a bad header cannot stall a view. */
export function retryAfterMs(response: Pick<Response, "headers">, now = Date.now()): number | undefined {
  const raw = response.headers.get("Retry-After")?.trim();
  if (!raw) return undefined;
  const ms = /^\d{1,6}$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms)) : undefined;
}

/** HTTP failure with the parsed envelope (when the body is one) and any retry hint. */
export function httpError(response: Pick<Response, "status" | "headers">, payload?: unknown, message = `AQ responded ${response.status}`): ApiError {
  const envelope = isErrorEnvelope(payload) ? payload : undefined;
  const after = retryAfterMs(response);
  return new ApiError("http", message, {
    status: response.status,
    ...(envelope && { envelope }),
    ...(after !== undefined && { retryAfterMs: after }),
  });
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    isRecord(value) &&
    typeof value.request_id === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal) {
  const headers = new Headers({ Accept: "application/json" });
  if (method !== "GET") headers.set("X-AQ-Request", "1");
  if (body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(signal && { signal }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("transport", "Could not reach AQ", { effectUnknown: method !== "GET" });
  }

  const isJson = response.headers.get("Content-Type")?.includes("application/json") ?? false;
  const payload: unknown = isJson ? await response.json().catch(() => undefined) : undefined;

  if (!response.ok) throw httpError(response, payload);
  if (!isJson || payload === undefined) {
    throw new ApiError("contract", "AQ returned a non-JSON response", { status: response.status });
  }
  return payload as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>("GET", path, undefined, signal);
}

export function apiSend<T>(
  method: Exclude<Method, "GET">,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>(method, path, body, signal);
}

/** Authorization and compatibility failures must never retain private stale reads. */
export function isProtectedReadFailure(error: unknown): error is Error {
  return error instanceof ContractError || (error instanceof ApiError &&
    (error.kind === "contract" || error.status === 401 || error.status === 403 || error.status === 426));
}

/** The sign-in itself is gone: the only per-request failure that may take over the shell. */
export function isAuthenticationFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

/** A refusal of one request or resource. It stays in the view that asked (QA §2A). */
export function isAccessRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403;
}

/**
 * The addressed item is missing, malformed or not visible to this principal.
 * Retrying or polling cannot change the answer; show the neutral not-found view.
 */
export function isMissingResource(error: unknown): error is ApiError {
  return error instanceof ApiError && [403, 404, 410, 422].includes(error.status ?? 0);
}
