import { observationBody } from "./observationBody";
import { readBoundedBody } from "./responseBytes";
import { ApiError } from "./client";

/** Finite, same-origin inspection only. Never persist or poll an accounting view. */
export async function sessionUsageJson(attempt: string, signal: AbortSignal): Promise<unknown> {
  const stream = await observationBody(`/api/observations/sessions/${encodeURIComponent(attempt)}/usage`, signal, "Session usage");
  const bytes = await readBoundedBody(stream, 16384, () => new ApiError("contract", "Session usage exceeds byte bound"));
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("contract", "Invalid session usage JSON");
  }
}
