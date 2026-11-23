import { apiSend, ApiError, isHttpClientError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

export const settingsRevision = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && /^(0|[1-9]\d*)$/.test(value);

export function savedRevision(receipt: unknown, what: string): string {
  if (isRecord(receipt) && settingsRevision(receipt.revision)) return receipt.revision;
  throw new ContractError(`Invalid ${what} response`);
}

/** Retain the exact submitted operation for retries whose outcome is unknown. */
export function settingsSaves<S extends { operation_id: string }, R>(
  path: string,
  copy: (request: S) => S,
  accepted: (receipt: unknown, request: S) => R,
) {
  const sent = new Map<string, S>();
  function remember(request: S): S {
    const existing = sent.get(request.operation_id);
    if (existing) return existing;
    const body = copy(request);
    if (sent.size >= 16) sent.delete(sent.keys().next().value!);
    sent.set(body.operation_id, body);
    return body;
  }
  async function save(request: S): Promise<R> {
    const body = remember(request);
    let receipt: unknown;
    try { receipt = await apiSend<unknown>("PUT", path, body); }
    catch (error) {
      if (isHttpClientError(error)) sent.delete(body.operation_id);
      throw error;
    }
    const result = accepted(receipt, body);
    sent.delete(body.operation_id);
    return result;
  }
  async function inspect(id: string): Promise<R> {
    const body = sent.get(id);
    if (!body) throw new ApiError("http", "This save was not sent from this page", { status: 404 });
    return save(body);
  }
  return { save, inspect };
}
