import { useEffect, useMemo, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useGraphDetail } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import { formatUntil } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";

export function useDecisionClock(serverTime: number | undefined, updatedAt: number | undefined) {
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  return useServerNow(serverTime === undefined ? undefined : { serverTime: new Date(serverTime).toISOString(), receivedAt }, { tickMs: 15_000 });
}

export function expiresLabel(now: string, expires: number) {
  const until = formatUntil(now, new Date(expires).toISOString());
  return until === "due now" ? "Expiry due now" : `Expires ${until}`;
}

export function useDecisionTask(row: { taskId: string; projectId: string }) {
  const { bootstrap } = useSession();
  return useGraphDetail(bootstrap.capability("human.graph.read").enabled ? row.projectId : "", "task", row.taskId);
}

export function useRefusedRefresh(refreshes: number, refused: boolean, reset: () => void) {
  // A deliberate refresh after a refusal releases the refused answer; the next submit
  // creates a new operation bound to whatever revision the refreshed evidence shows.
  const seenRefreshes = useRef(refreshes);
  useEffect(() => {
    if (refreshes === seenRefreshes.current) return;
    seenRefreshes.current = refreshes;
    if (refused) reset();
  }, [refreshes, refused, reset]);
}

/** A recorded answer changes the overview's Needs you list and count, so re-read it with the inbox. */
export function refreshOverview(client: QueryClient, principalId: string) {
  return client.invalidateQueries({ predicate: q => q.queryKey[0] === "aq" && q.queryKey[1] === principalId && q.queryKey[4] === "overview" });
}
