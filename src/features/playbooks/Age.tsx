import { useMemo } from "react";
import { formatAge } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";

/**
 * Server "now" for a playbook read: the response's server clock plus monotonic
 * time since it arrived (never the local wall clock). `updatedAt` re-anchors on refetch.
 */
export function useObservedNow(observedAt: number | undefined, updatedAt: number): string | null {
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  return useServerNow(observedAt === undefined ? undefined : { serverTime: new Date(observedAt).toISOString(), receivedAt });
}

/** Relative age (`18m ago`) with the exact ISO instant in `dateTime` and `title`. */
export function Age({ at, now }: { at: number; now: string | null }) {
  const iso = new Date(at).toISOString();
  return <time dateTime={iso} title={iso}>{now ? formatAge(now, iso) : "unknown time"}</time>;
}
