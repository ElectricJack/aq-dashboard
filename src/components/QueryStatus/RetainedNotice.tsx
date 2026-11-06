import { useEffect, useState } from "react";
import { formatAge } from "../time/relative";
import { useOnline } from "../useOnline";
import styles from "./QueryStatus.module.css";

/** The parts of a TanStack query result the notice reads. */
export type RetainedRead = { data?: unknown; dataUpdatedAt: number; isError: boolean };

const TICK_MS = 15_000;

/** Age of the browser's last successful read, re-rendered while it is shown. */
function useAge(updatedAt: number, shown: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!shown) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [shown, updatedAt]);
  return formatAge(new Date(Math.max(now, updatedAt)).toISOString(), new Date(updatedAt).toISOString());
}

/**
 * Shared stale marker (0002 §10 "mark its age", QA SO-13). Shown only while a
 * view keeps a previous read: after a failed refresh, or while the browser is
 * offline (queries pause rather than fail, so nothing else would say so).
 * Renders nothing when the read is current or there is no retained data.
 */
export function RetainedNotice({ query, className }: { query: RetainedRead; className?: string }) {
  const online = useOnline();
  const retained = query.data !== undefined && query.dataUpdatedAt > 0;
  const shown = retained && (query.isError || !online);
  const age = useAge(query.dataUpdatedAt, shown);
  if (!shown) return null;
  const read = `Showing data read ${age}`;
  return (
    <p className={className ?? styles.retained} role="status" data-retained={online ? "refresh-failed" : "offline"}>
      {online ? `Refresh failed. ${read}, which may be out of date.` : `Offline. ${read}; it will refresh when you reconnect.`}
    </p>
  );
}
