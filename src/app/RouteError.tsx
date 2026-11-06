import { useEffect, useState } from "react";
import { useRouteError } from "react-router";
import queryStatus from "../components/QueryStatus/QueryStatus.module.css";
import { isChunkLoadError, reloadOnceForUpdate } from "./chunkReload";
import styles from "./RouteError.module.css";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "statusText" in error) return String((error as { statusText: unknown }).statusText);
  return "Unknown error";
}

/** Route-level errorElement: replaces React Router's default error page. */
export function RouteError() {
  const error = useRouteError();
  const chunk = isChunkLoadError(error);
  // Tracks the one automatic reload; until it happens (or is refused) show nothing alarming.
  const [reloading, setReloading] = useState(chunk);
  useEffect(() => {
    if (chunk && !reloadOnceForUpdate()) setReloading(false);
  }, [chunk]);
  if (reloading) return <p className={queryStatus.status} role="status">Updating dashboard…</p>;
  return (
    <div className={`${queryStatus.error} ${styles.panel}`} role="alert">
      <p>
        {chunk
          ? "The dashboard was updated or the server is unreachable."
          : "Something went wrong showing this page."}
      </p>
      <button type="button" className={queryStatus.retry} onClick={() => window.location.reload()}>
        Reload
      </button>
      <details className={styles.details}>
        <summary>Details</summary>
        <pre>{messageOf(error)}</pre>
      </details>
    </div>
  );
}
