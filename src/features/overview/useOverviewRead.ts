import { adaptOverview, type OverviewView } from "../../api/adapters/inspection";
import type { Scope } from "../../api/wire/proposed";
import type { Overview as OverviewWire } from "../../api/wire/overview";
import { useRead } from "../../app/useRead";

/** Initial foreground budget from docs/plans/0001 §2. */
const OVERVIEW_POLL_MS = 10_000;

/** The overview read. Overview and the Decisions page share one query key, so one fetch feeds both. */
export function useOverviewRead(scope: Scope, enabled?: boolean) {
  return useRead<OverviewWire, OverviewView>({
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: OVERVIEW_POLL_MS,
    enabled,
  });
}
