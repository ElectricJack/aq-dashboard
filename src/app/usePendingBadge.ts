import { adaptOverview, type OverviewView } from "../api/adapters/inspection";
import { decisionTotal } from "../api/adapters/overview";
import type { Overview as OverviewWire } from "../api/wire/overview";
import type { Scope } from "../api/wire/proposed";
import { useRead } from "./useRead";
const BADGE_POLL_MS = 30_000;

/**
 * Pending count for the Decisions destination, from the scoped overview's
 * review and question source totals (shared query with the Overview page), not
 * `needs_you`, which also counts offline workers and failed results (RR-02).
 * Null when unknown or zero so the shell never shows an invented or empty badge.
 */
export type Badge = { text: string; label: string };
export function usePendingBadge(scope: Scope, enabled: boolean): Badge | null {
  const read = useRead<OverviewWire, OverviewView>({
    enabled,
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: BADGE_POLL_MS,
  });
  if (!enabled || read.isError) return null;
  if (!read.data) return null;
  return pendingBadge(decisionTotal(read.data.view.sources), read.data.coverage.state);
}

function pendingBadge(total: ReturnType<typeof decisionTotal>, coverage: string): Badge | null {
  if (!total?.value || total.value < 0) return null;
  const approximate = total.accuracy !== "exact" || coverage !== "complete";
  const shown = total.value > 99 ? "99+" : String(total.value);
  return {
    text: approximate ? `~${shown}` : shown,
    // The name must contain the visible badge text (WCAG 2.5.3): "~3" reads as "3 pending, approximate".
    label: `${shown} pending${approximate ? ", approximate" : ""}`,
  };
}
