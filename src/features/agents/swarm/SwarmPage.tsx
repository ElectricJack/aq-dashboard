import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { adaptOverview, type OverviewView } from "../../../api/adapters/inspection";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Overview as OverviewWire } from "../../../api/wire/proposed";
import type { Swarm } from "../../../api/wire/swarm";
import {useMediaQuery} from "../../../components/useMediaQuery";
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
import { SwarmStatusHeader } from "./SwarmStatusHeader";
import { useWorkerSettings, applyWorkerSettings } from "./WorkerManagement";
import styles from "./Swarm.module.css";

/** Polls an object may be missing from the swarm before the pane lets go of its last known state. */
export const HOLD_POLLS = 3;

export function SwarmPage() { return <ManualAgentsProvider><SwarmPageBody /></ManualAgentsProvider>; }
function SwarmPageBody() {
  const { bootstrap, queryContext } = useSession();
  const cap = bootstrap.capability("swarm.read");
  const desktop=useMediaQuery("(min-width: 1024px)");
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  // A malformed swarm response stays in this view (PANEL_READ), never the global update screen.
  const swarm = useRead<Swarm, SwarmView>({ resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS, enabled: cap.enabled, meta: PANEL_READ });
  const overviewCap = bootstrap.capability("dashboard.overview");
  const overview = useRead<OverviewWire, OverviewView>({ resource: "overview", path: "/api/v1/overview", scope: { kind: "all_authorized" }, adapt: adaptOverview, pollMs: 10_000, enabled: overviewCap.enabled });
  const manual=useManualAgents();
  const settings = useWorkerSettings();
  const selectParam = params.get("select");
  const view = useMemo(() => swarm.data?.view ? applyWorkerSettings(mergeManual(swarm.data.view, manual?.fleet, manual?.project ?? null, selectParam), settings.data) : undefined,
    [swarm.data?.view, manual?.fleet, manual?.project, selectParam, settings.data]);
  const ready = overview.data?.view.counts.ready.value ?? null;
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
  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1000);
  const storageKey = `aq.swarm.tree-width:${queryContext.principalId}`;
  const [preference, setPreference] = useState<{ key: string; percent: number } | null>(null);
  const drag = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const focused = shown.selection?.kind === "agent" && params.get("focus") === "terminal";
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const percent = stored === null ? NaN : Number(stored);
      setPreference(Number.isFinite(percent) && percent >= 0 && percent <= 100 ? { key: storageKey, percent } : null);
    } catch { setPreference(null); }
  }, [storageKey]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => { const width = element.getBoundingClientRect().width; if (width > 0) setStageWidth(width); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cap.enabled]);
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    const cursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => { document.body.style.userSelect = previous; document.body.style.cursor = cursor; };
  }, [dragging]);
  useEffect(() => { if (!desktop || focused) { drag.current = null; setDragging(false); } }, [desktop, focused]);
  const available = Math.max(1, stageWidth - 10);
  const minimum = Math.min(320, available / 2);
  const minPercent = minimum / available * 100;
  const maxPercent = 100 - minPercent;
  const defaultPercent = (available - (shown.selection?.kind === "agent" ? Math.min(720, available * .55) : 360)) / available * 100;
  const treePercent = Math.max(minPercent, Math.min(maxPercent, preference?.key === storageKey ? preference.percent : defaultPercent));
  const resize = (percent: number) => {
    const next = Math.max(minPercent, Math.min(maxPercent, percent));
    setPreference({ key: storageKey, percent: next });
    try { localStorage.setItem(storageKey, String(next)); } catch { /* The split still works when storage is unavailable. */ }
  };
  const finishDrag = () => { drag.current = null; setDragging(false); };
  const coverage = swarm.data?.coverage;
  const resolvedCapacity=coverage?.reason==='Some online workers advertise no slot total'&&view?.machines.every(m=>m.nodes.every(n=>n.health!=='online'||n.slots.total!==null));
  const stale = swarm.isError && !!view;
  const anchor = swarm.data && { serverTime: swarm.data.serverTime, receivedAt: performance.now() - (Date.now() - swarm.dataUpdatedAt) };
  const now = useServerNow(anchor);

  if (!cap.enabled) {
    return <>
      <AgentsTabs current="swarm" />
      <p role="note">Swarm is not available on this server. <Link to={{ pathname: "/agents/history", search }}>Open History</Link></p>
    </>;
  }
  return <>
    <AgentsTabs current="swarm" />
    {coverage?.state === "partial" && coverage.reason && !resolvedCapacity && <p className={styles.coverage}>{coverage.reason}</p>}
    {stale && swarm.data && <p role="status" className={styles.coverage}>Stale: the latest refresh failed. Last updated {now ? formatAge(now, swarm.data.serverTime) : "earlier"}.</p>}
    <SwarmStatusHeader />
    <div ref={stage} className={styles.stage} style={desktop && !focused ? { "--swarm-tree-width": treePercent / 100 } as CSSProperties : undefined} data-resizing={dragging || undefined} data-viewport-fit={desktop || (shown.selection?.kind==="agent" && params.get("focus")==="terminal") || undefined} data-wide={shown.selection?.kind === "agent" || undefined} data-focus={shown.selection?.kind==="agent"&&params.get("focus")==="terminal"||undefined}>
      {view
        ? <SwarmTree view={view} ready={ready} selected={shown.selection} stale={stale} onSelect={select} />
        : <div className={styles.flow}><QueryStatus status={swarm.isError ? "error" : "pending"} error={swarm.error} label="the swarm" onRetry={() => void swarm.refetch()} /></div>}
      <div className={styles.divider} role="separator" aria-label="Resize swarm tree and properties" aria-orientation="vertical"
        aria-valuemin={Math.round(minPercent)} aria-valuemax={Math.round(maxPercent)} aria-valuenow={Math.round(treePercent)} aria-valuetext={`${Math.round(treePercent)}% tree width`}
        tabIndex={desktop && !focused ? 0 : -1} aria-hidden={!desktop || focused || undefined}
        onPointerDown={event => {
          if (!desktop || focused || event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = event.pointerId; setDragging(true);
        }}
        onPointerMove={event => {
          if (drag.current !== event.pointerId) return;
          const bounds = stage.current?.getBoundingClientRect();
          if (bounds && bounds.width > 10) resize((event.clientX - bounds.left - 5) / (bounds.width - 10) * 100);
        }}
        onPointerUp={event => { if (drag.current === event.pointerId) { finishDrag(); event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={event => {
          const next = event.key === "Home" ? minPercent : event.key === "End" ? maxPercent : event.key === "ArrowLeft" ? treePercent - (event.shiftKey ? 10 : 2) : event.key === "ArrowRight" ? treePercent + (event.shiftKey ? 10 : 2) : null;
          if (next !== null) { event.preventDefault(); resize(next); }
        }} />
      <aside ref={pane} className={styles.pane} aria-label="Properties">{shown.view && <SwarmPane view={shown.view} selection={shown.selection} ready={ready} note={shown.note} />}</aside>
    </div>
  </>;
}
