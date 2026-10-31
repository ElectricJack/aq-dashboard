import { isRecord } from "./adapters/contract";
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
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
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

  if (!response.ok) {
    throw new ApiError("http", `AQ responded ${response.status}`, {
      status: response.status,
      ...(isErrorEnvelope(payload) && { envelope: payload }),
    });
  }
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
