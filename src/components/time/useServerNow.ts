import { useEffect, useState } from "react";

export type ServerAnchor = { serverTime: string; receivedAt: number };

/**
 * Current server time estimated as the last response's server_time plus
 * monotonic elapsed time since it arrived. The local wall clock is never used.
 */
export function useServerNow(
  anchor: ServerAnchor | undefined,
  { now = () => performance.now(), tickMs = 15_000 }: { now?: () => number; tickMs?: number } = {},
): string | null {
  const [, setTick] = useState(0);
  const anchored = anchor !== undefined;
  useEffect(() => {
    if (!anchored) return;
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [anchored, tickMs]);
  if (!anchor) return null;
  const base = Date.parse(anchor.serverTime);
  if (Number.isNaN(base)) return anchor.serverTime;
  return new Date(base + Math.max(0, now() - anchor.receivedAt)).toISOString();
}
