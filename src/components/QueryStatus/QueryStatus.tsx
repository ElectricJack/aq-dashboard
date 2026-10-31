import { ApiError } from "../../api/client";
import styles from "./QueryStatus.module.css";

type Props = {
  status: "pending" | "error";
  error: unknown;
  /** What is being loaded, in lower case: "tasks", "this task". */
  label: string;
  onRetry(): void;
};

function describe(error: unknown, label: string): { text: string; retry: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) return { text: "Your sign-in has expired. Sign in through AQ, then reload.", retry: false };
    if (error.status === 403) return { text: `Viewing ${label} is not permitted for your account.`, retry: false };
    if (error.status === 404) return { text: "This item does not exist or is not available to you.", retry: false };
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
export function QueryStatus({ status, error, label, onRetry }: Props) {
  if (status === "pending") {
    return (
      <p className={styles.status} role="status">
        Loading {label}…
      </p>
    );
  }
  const { text, retry } = describe(error, label);
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
