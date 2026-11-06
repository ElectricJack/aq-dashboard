import { ContractError } from "./adapters/contract";
import { ApiError } from "./client";

/**
 * Read retry policy (QA SO-10, RA-15, §2B). Only a failure that can clear by
 * itself is retried: lost transport, 429 capacity and 5xx unavailability the
 * server did not mark `retryable: false`. A 4xx answer is the server's answer;
 * retrying or polling it only delays the view that has to explain it.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "TimeoutError";
  if (error instanceof ContractError || !(error instanceof ApiError)) return false;
  if (error.kind === "transport") return true;
  if (error.kind !== "http") return false;
  const status = error.status ?? 0;
  if (error.envelope?.retryable === false) return false;
  if (status === 429 || status === 408) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  return status >= 500 && error.envelope?.retryable === true;
}

/** Read attempts after the first one. */
export const READ_RETRIES = 3;
const BASE_MS = 500;
const CAP_MS = 8_000;

/**
 * Exponential backoff with jitter, never sooner than the server's Retry-After.
 * `attempt` counts from 0 for the first retry.
 */
export function retryDelayMs(attempt: number, error?: unknown, random: () => number = Math.random): number {
  const ceiling = Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt));
  // "Equal jitter": at least half the step, so a burst of views spreads out but never hammers.
  const backoff = ceiling / 2 + random() * (ceiling / 2);
  const hinted = error instanceof ApiError ? error.retryAfterMs : undefined;
  return Math.round(hinted !== undefined ? Math.max(hinted, backoff) : backoff);
}

/** TanStack Query `retry` for reads. */
export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  return failureCount < READ_RETRIES && isRetryableError(error);
}

/** TanStack Query `retryDelay` (its failure count starts at 1 for the first retry). */
export function readRetryDelay(failureCount: number, error: unknown): number {
  return retryDelayMs(failureCount - 1, error);
}

/** Spread into a query's options to opt into the shared read retry policy. */
export const readRetry = { retry: shouldRetryRead, retryDelay: readRetryDelay } as const;

/**
 * `refetchInterval` that polls at `ms` and stops once the last read failed with
 * an answer that polling cannot change (missing item, refusal, bad request).
 * A later explicit refetch that succeeds resumes polling.
 */
export function pollUnlessSettled(ms: number) {
  return (query: { state: { status: string; error: unknown } }): number | false =>
    query.state.status === "error" && !isRetryableError(query.state.error) ? false : ms;
}
