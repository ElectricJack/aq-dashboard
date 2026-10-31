import { formatAge } from "../time/relative";
import styles from "./QueryStatus.module.css";

/** Observation age from server time; stale values say so and keep their age. */
export function FreshnessLabel({
  serverTime,
  observedAt,
  stale,
}: {
  serverTime: string;
  observedAt: string;
  stale: boolean;
}) {
  const age = formatAge(serverTime, observedAt);
  return stale ? (
    <span className={styles.stale}>Stale, observed {age}</span>
  ) : (
    <span className={styles.fresh}>updated {age}</span>
  );
}
