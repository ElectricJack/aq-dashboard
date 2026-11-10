import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { adaptOverview, type OverviewView } from "../../../api/adapters/inspection";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Overview as OverviewWire } from "../../../api/wire/proposed";
import type { Swarm } from "../../../api/wire/swarm";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { formatAge } from "../../../components/time/relative";
import { useServerNow } from "../../../components/time/useServerNow";
import { PANEL_READ, useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import { AgentsTabs } from "../AgentsTabs";
import { buildSwarmGraph, selectionId, type Selection } from "./graph";
import {ManualAgentsProvider,useManualAgents,mergeManual} from "./manualAgents";
import { SwarmPane } from "./SwarmPane";
import { SwarmTree } from "./SwarmTree";
import styles from "./Swarm.module.css";

/** Polls an object may be missing from the swarm before the pane lets go of its last known state. */
export const HOLD_POLLS = 3;

export function SwarmPage() { return <ManualAgentsProvider><SwarmPageBody /></ManualAgentsProvider>; }
function SwarmPageBody() {
  const { bootstrap } = useSession();
  const cap = bootstrap.capability("swarm.read");
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  // A malformed swarm response stays in this view (PANEL_READ), never the global update screen.
  const swarm = useRead<Swarm, SwarmView>({ resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS, enabled: cap.enabled, meta: PANEL_READ });
  const overviewCap = bootstrap.capability("dashboard.overview");
  const overview = useRead<OverviewWire, OverviewView>({ resource: "overview", path: "/api/v1/overview", scope: { kind: "all_authorized" }, adapt: adaptOverview, pollMs: 10_000, enabled: overviewCap.enabled });
  const manual=useManualAgents();
  const view = swarm.data?.view ? mergeManual(swarm.data.view,manual?.fleet,manual?.project??null,params.get("select")) : undefined;
  const ready = overview.data?.view.counts.ready.value ?? null;
  const selectParam = params.get("select");
  // Sessions whose terminal already took control on this page; a remount after a data flap must not retake it.
  const pane = useRef<HTMLElement>(null);
  const focusPane = useRef(false);
  const held = useRef<{ param: string; view: SwarmView; selection: Selection; misses: number; seenAt: number } | null>(null);

  // A selection id that no longer exists in the tree shows the empty pane, after holding the last known object for a few polls.
  const resolved = useMemo<Selection | null>(() => {
    if (!view || !selectParam) return null;
    return buildSwarmGraph(view, { host: "", ready, now: view.serverTime }).nodes.find(n => n.id === selectParam)?.data.selection ?? null;
  }, [view, ready, selectParam]);
  let shown: { selection: Selection | null; view: SwarmView | undefined; note: string | null } = { selection: resolved, view, note: null };
  if (resolved && view && selectParam) held.current = { param: selectParam, view, selection: resolved, misses: 0, seenAt: swarm.dataUpdatedAt };
  else if (held.current && held.current.param === selectParam && view) {
    // Each completed poll counts once, even when its content equals the previous one.
    if (held.current.seenAt !== swarm.dataUpdatedAt) { held.current.misses += 1; held.current.seenAt = swarm.dataUpdatedAt; }
    if (held.current.misses <= HOLD_POLLS) shown = { selection: held.current.selection, view: held.current.view, note: "This object is not in the latest update. Showing its last known state." };
  } else if (!selectParam) held.current = null;

  const select = (s: Selection) => {
    focusPane.current = true;
    setParams(prev => { const next = new URLSearchParams(prev); next.set("select", selectionId(s)); return next; }, { replace: true });
  };
  // On a narrow viewport the pane is below the tree: bring it into view and move focus to its heading.
  useEffect(() => {
    if (!focusPane.current || !shown.selection) return;
    focusPane.current = false;
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023px)").matches) {
      pane.current?.scrollIntoView?.({ block: "start" });
      pane.current?.querySelector<HTMLElement>("h2")?.focus();
    }
  });
  const coverage = swarm.data?.coverage;
  const stale = swarm.isError && !!view;
  const anchor = swarm.data && { serverTime: swarm.data.serverTime, receivedAt: performance.now() - (Date.now() - swarm.dataUpdatedAt) };
  const now = useServerNow(anchor);

  if (!cap.enabled) {
    return <>
      <AgentsTabs current="swarm" />
      <p role="note">Swarm is not available on this server. <Link to={{ pathname: "/agents/sessions", search }}>Open Sessions</Link></p>
    </>;
  }
  return <>
    <AgentsTabs current="swarm" />
    {coverage?.state === "partial" && coverage.reason && <p className={styles.coverage}>{coverage.reason}</p>}
    {stale && swarm.data && <p role="status" className={styles.coverage}>Stale: the latest refresh failed. Last updated {now ? formatAge(now, swarm.data.serverTime) : "earlier"}.</p>}
    <div className={styles.stage} data-wide={shown.selection?.kind === "agent" || undefined}>
      {view
        ? <SwarmTree view={view} ready={ready} selected={shown.selection} stale={stale} onSelect={select} />
        : <div className={styles.flow}><QueryStatus status={swarm.isError ? "error" : "pending"} error={swarm.error} label="the swarm" onRetry={() => void swarm.refetch()} /></div>}
      <aside ref={pane} className={styles.pane} aria-label="Properties">{shown.view && <SwarmPane view={shown.view} selection={shown.selection} ready={ready} note={shown.note} />}</aside>
    </div>
  </>;
}
