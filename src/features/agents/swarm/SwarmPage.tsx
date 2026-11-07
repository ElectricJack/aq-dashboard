import { useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { adaptOverview, type OverviewView } from "../../../api/adapters/inspection";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Overview as OverviewWire } from "../../../api/wire/proposed";
import type { Swarm } from "../../../api/wire/swarm";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import { AgentsTabs } from "../AgentsTabs";
import { buildSwarmGraph, selectionId, type Selection } from "./graph";
import { SwarmPane } from "./SwarmPane";
import { SwarmTree } from "./SwarmTree";
import styles from "./Swarm.module.css";

export function SwarmPage() {
  const { bootstrap } = useSession();
  const cap = bootstrap.capability("swarm.read");
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const swarm = useRead<Swarm, SwarmView>({ resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS, enabled: cap.enabled });
  const overviewCap = bootstrap.capability("dashboard.overview");
  const overview = useRead<OverviewWire, OverviewView>({ resource: "overview", path: "/api/v1/overview", scope: { kind: "all_authorized" }, adapt: adaptOverview, pollMs: 10_000, enabled: overviewCap.enabled });
  const view = swarm.data?.view;
  const ready = overview.data?.view.counts.ready.value ?? null;
  const selectParam = params.get("select");
  // A selection id that no longer exists in the tree shows the empty pane.
  const selection = useMemo<Selection | null>(() => {
    if (!view || !selectParam) return null;
    return buildSwarmGraph(view, { host: "", ready, now: view.serverTime }).nodes.find(n => n.id === selectParam)?.data.selection ?? null;
  }, [view, ready, selectParam]);
  const select = (s: Selection) => setParams(prev => { const next = new URLSearchParams(prev); next.set("select", selectionId(s)); return next; });
  const coverage = swarm.data?.coverage;

  if (!cap.enabled) {
    return <>
      <AgentsTabs current="swarm" />
      <p role="note">Swarm is not available on this server. <Link to={{ pathname: "/agents/sessions", search }}>Open Sessions</Link></p>
    </>;
  }
  return <>
    <AgentsTabs current="swarm" />
    {coverage?.state === "partial" && coverage.reason && <p className={styles.coverage}>{coverage.reason}</p>}
    <div className={styles.stage} data-wide={selection?.kind === "agent" || undefined}>
      {view
        ? <SwarmTree view={view} ready={ready} selected={selection} onSelect={select} />
        : <div className={styles.flow}><QueryStatus status={swarm.isError ? "error" : "pending"} error={swarm.error} label="the swarm" onRetry={() => void swarm.refetch()} /></div>}
      <aside className={styles.pane} aria-label="Properties">{view && <SwarmPane view={view} selection={selection} ready={ready} />}</aside>
    </div>
  </>;
}
