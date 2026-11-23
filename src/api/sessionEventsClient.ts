import { observationBody } from "./observationBody";
import { readBoundedBody } from "./responseBytes";
import { parseUnsignedJson } from "./unsignedJson";
import { ApiError } from "./client";
import type { EventsCursor } from "./adapters/sessionEvents";

/** One explicit bounded historical read, never a poll or content-byte request. */
export async function sessionEventsJson(attempt: string, cursor: EventsCursor, signal: AbortSignal): Promise<unknown> {
  const params = new URLSearchParams({ after_sequence: String(cursor.after), limit: "16" });
  if (cursor.through !== undefined) params.set("through_sequence", String(cursor.through));
  const stream = await observationBody(`/api/observations/sessions/${encodeURIComponent(attempt)}/events?${params}`, signal, "Session source events");
  const bytes = await readBoundedBody(stream, 262144, () => new ApiError("contract", "Session source events exceed byte bound"));
  try {
    return parseUnsignedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("contract", "Invalid session source events JSON");
  }
}
