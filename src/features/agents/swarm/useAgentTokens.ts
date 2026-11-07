import { useQuery } from "@tanstack/react-query";
import { adaptSessionDetail, type SessionDetailView } from "../../../api/adapters/inspection";
import { adaptSessionUsage } from "../../../api/adapters/sessionUsage";
import { sessionUsageJson } from "../../../api/sessionUsageClient";
import { queryKey } from "../../../api/queryKeys";
import type { SessionDetail } from "../../../api/wire/proposed";
import { useRead } from "../../../app/useRead";
import { useSession } from "../../../app/session";

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** "41k in / 6k out" from the session's accounting, or "unknown". Unknown is never shown as 0. */
export function useAgentTokens(sessionId: string): { text: string } {
  const { bootstrap, queryContext } = useSession();
  const detail = useRead<SessionDetail, SessionDetailView>({
    resource: "session", path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`, adapt: adaptSessionDetail,
  });
  const binding = detail.data?.view.observationBinding ?? null;
  const usage = useQuery({
    queryKey: queryKey(queryContext, "session-usage", { binding }),
    enabled: !!binding && bootstrap.capability("session.usage.read").enabled,
    queryFn: async ({ signal }) => adaptSessionUsage(await sessionUsageJson(binding!.attempt_id, signal), binding!),
    staleTime: 0, refetchOnWindowFocus: false,
  });
  const counters = usage.data?.usage.counters;
  if (!counters || counters.input.kind !== "known" || counters.output.kind !== "known") return { text: "unknown" };
  return { text: `${fmt(counters.input.value)} in / ${fmt(counters.output.value)} out` };
}
