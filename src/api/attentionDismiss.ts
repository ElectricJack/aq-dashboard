import { ApiError, apiSend } from "./client";

/** Capability that offers dismissal (contracts/proposed/attention-dismissal.md). Absent or disabled hides the control. */
export const ATTENTION_DISMISS = "attention.dismiss";

/**
 * - `dismissed`: recorded, or already gone (a repeat or a missing item is not an error).
 * - `changed`: the server refused because the item's revision moved or its kind cannot be dismissed (409/422);
 *   the caller re-reads and shows what is current, with no error.
 */
export type DismissOutcome = "dismissed" | "changed";

/** Dismissal never approves, releases, cancels or resolves anything; it only clears the item from Needs you. */
export async function dismissAttention(id: string, expectedRevision: string): Promise<DismissOutcome> {
  try {
    await apiSend("POST", `/api/v1/attention/${encodeURIComponent(id)}/dismiss`, { expected_revision: expectedRevision });
    return "dismissed";
  } catch (error) {
    if (error instanceof ApiError && error.kind === "http") {
      if (error.status === 404 || error.status === 410) return "dismissed";
      if (error.status === 409 || error.status === 422) return "changed";
    }
    throw error;
  }
}
