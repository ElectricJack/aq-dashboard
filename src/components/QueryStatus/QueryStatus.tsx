import { ContractError } from "../../api/adapters/contract";
import { ApiError, isMissingResource } from "../../api/client";
import { isRetryableError } from "../../api/retry";
import styles from "./QueryStatus.module.css";

type Props = {
  status: "pending" | "error";
  error: unknown;
  /** What is being loaded, in lower case: "tasks", "this task". */
  label: string;
  onRetry(): void;
  /**
   * What the read addresses. An `item` (one decision, result, task, session…)
   * that is refused, missing or malformed gets the neutral not-found view
   * without leaking whether it exists (0002 §3). Defaults to `item` when the
   * label starts with "this ".
   */
  subject?: "item" | "collection";
};

export const NOT_FOUND_TEXT = "This item does not exist or is not available to you.";

function describe(error: unknown, label: string, item: boolean): { text: string; retry: boolean } {
  if (item && isMissingResource(error)) return { text: NOT_FOUND_TEXT, retry: false };
  if (error instanceof ContractError) {
    return { text: `This dashboard can't read AQ's response for ${label}. It may need updating.`, retry: false };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return { text: "Your sign-in has expired. Sign in through AQ, then reload.", retry: false };
    if (error.status === 403) return { text: `Viewing ${label} is not permitted for your account.`, retry: false };
    if (error.status === 404 || error.status === 410) return { text: NOT_FOUND_TEXT, retry: false };
    if (error.status === 422 || error.status === 400) {
      return { text: `AQ can't read ${label} with these settings. Check the address or filters.`, retry: false };
    }
    if (error.kind === "http" && !isRetryableError(error) && error.status !== 409 && (error.status ?? 0) < 500) {
      return { text: `AQ refused the request for ${label}.${error.envelope?.message ? ` ${error.envelope.message}` : ""}`, retry: false };
    }
    if (error.kind === "contract") {
      return { text: `This dashboard can't read AQ's response for ${label}. It may need updating.`, retry: false };
    }
  }
  return { text: `Couldn't load ${label}. Nothing is shown rather than possibly incomplete data.`, retry: true };
}

/**
 * Loading and failure presentation for a read. Neither state may resemble
 * an empty successful result (docs/specs/0002 §10).
 */
export function QueryStatus({ status, error, label, onRetry, subject }: Props) {
  if (status === "pending") {
    return (
      <p className={styles.status} role="status">
        Loading {label}…
      </p>
    );
  }
  const { text, retry } = describe(error, label, (subject ?? (label.startsWith("this ") ? "item" : "collection")) === "item");
  return (
    <div className={styles.error} role="alert">
      <p>{text}</p>
      {retry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
