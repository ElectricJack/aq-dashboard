import type { QueryClient } from "@tanstack/react-query";
import { ContractError } from "../../api/adapters/contract";
import { ApiError } from "../../api/client";

/**
 * The app's shared read-retry policy (owned by the query client defaults), except that a
 * missing item is reported at once. A busy inspection read (for example a retryable
 * `playbook_capacity_exhausted`) is therefore retried with the shared backoff instead of
 * failing the page.
 */
export function retryUnlessMissing(client: QueryClient) {
  const shared = client.getDefaultOptions().queries?.retry;
  return (count: number, error: Error): boolean => {
    if (error instanceof ApiError && error.status === 404) return false;
    if (typeof shared === "function") return shared(count, error);
    if (typeof shared === "number") return count < shared;
    return shared ?? count < 3;
  };
}

/** Whether a read failure is one the user can retry (the case QueryStatus offers "Try again" for). */
export function retryableReadFailure(error: unknown): boolean {
  if (error instanceof ContractError) return false;
  if (error instanceof ApiError) return error.kind !== "contract" && ![401, 403, 404].includes(error.status ?? 0);
  return true;
}
