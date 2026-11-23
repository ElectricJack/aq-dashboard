import { SwarmDivider, useSwarmSplit } from "./SwarmDivider";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { adaptOverview, type OverviewView } from "../../../api/adapters/inspection";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Overview as OverviewWire } from "../../../api/wire/proposed";
import type { Swarm } from "../../../api/wire/swarm";
import { useMediaQuery } from "../../../components/useMediaQuery";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { formatAge } from "../../../components/time/relative";
import { useServerNow } from "../../../components/time/useServerNow";
import { PANEL_READ, useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import { AgentsTabs } from "../AgentsTabs";
import { buildSwarmGraph, selectionId, type Selection } from "./graph";
import { ManualAgentsProvider, useManualAgents, mergeManual } from "./manualAgents";
import { SwarmPane } from "./SwarmPane";
import { SwarmTree } from "./SwarmTree";
import { SwarmStatusHeader } from "./SwarmStatusHeader";
import { SlotBoard, SwarmSummary, type SwarmViewMode } from "./SlotBoard";
import { useAgentFacts } from "./useAgentFacts";
import { useWorkerSettings, applyWorkerSettings } from "./WorkerManagement";
import styles from "./Swarm.module.css";

/** Polls an object may be missing from the swarm before the pane lets go of its last known state: about thirty seconds. */
export const HOLD_POLLS = Math.round(30_000 / SWARM_POLL_MS);

export function SwarmPage() { return <ManualAgentsProvider><SwarmPageBody /></ManualAgentsProvider>; }
function useSwarmView(source: SwarmView | undefined, selectParam: string | null) {
  const manual = useManualAgents();
  const fleet = manual?.fleet, project = manual?.project ?? null;
  const settings = useWorkerSettings();
  const merged = useMemo(() => source ? applyWorkerSettings(mergeManual(source, fleet, project, selectParam), settings.data) : undefined,
    [source, fleet, project, selectParam, settings.data]);
  // Task titles and role, level, model and effort the swarm read does not carry yet, from each task's own reads.
  return useAgentFacts(merged);
}
function useReadyCount(enabled: boolean) {
  const overview = useRead<OverviewWire, OverviewView>({
    resource: "overview", path: "/api/v1/overview", scope: { kind: "all_authorized" }, adapt: adaptOverview, pollMs: 10_000, enabled,
  });
  return overview.data?.view.counts.ready.value ?? null;
}
function useGraphData(selectParam: string | null) {
  const { bootstrap, queryContext } = useSession();
  const cap = bootstrap.capability("swarm.read");
  // A malformed swarm response stays in this view (PANEL_READ), never the global update screen.
  const swarm = useRead<Swarm, SwarmView>({ resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS, enabled: cap.enabled, meta: PANEL_READ });
  const ready = useReadyCount(bootstrap.capability("dashboard.overview").enabled);
  const view = useSwarmView(swarm.data?.view, selectParam);
  const stale = swarm.isError && !!view;
  const anchor = swarm.data && { serverTime: swarm.data.serverTime, receivedAt: performance.now() - (Date.now() - swarm.dataUpdatedAt) };
  const now = useServerNow(anchor);
  return { cap, principal: queryContext.principalId, swarm, view, ready, stale, anchor, now };
}
type GraphData = ReturnType<typeof useGraphData>;
type Held = { param: string; view: SwarmView; selection: Selection; misses: number; seenAt: number };
function retained(held: Held, seenAt: number) {
  // Each completed poll counts once, even when its content equals the previous one.
  if (held.seenAt !== seenAt) { held.misses++; held.seenAt = seenAt; }
  if (held.misses > HOLD_POLLS) return null;
  return { selection: held.selection, view: held.view, note: "This object is not in the latest update. Showing its last known state." };
}
function matchSelection(view: SwarmView | undefined, ready: number | null, param: string | null) {
  if (!view || !param) return null;
  const { nodes } = buildSwarmGraph(view, { host: "", ready, now: view.serverTime });
  const selected = nodes.find(n => n.id === param);
  return selected ? { selection: selected.data.selection, view, param } : null;
}
function useSelectedObject(data: GraphData, selectParam: string | null) {
  const { view, ready, swarm } = data;
  const held = useRef<Held | null>(null);
  // A selection id that no longer exists in the tree shows the empty pane, after holding the last known object for a few polls.
  const match = useMemo(() => matchSelection(view, ready, selectParam), [view, ready, selectParam]);
  const current = { selection: match?.selection ?? null, view, note: null };
  if (match) {
    held.current = { ...match, misses: 0, seenAt: swarm.dataUpdatedAt };
    return current;
  }
  if (!selectParam) {
    held.current = null;
    return current;
  }
  if (!view || held.current?.param !== selectParam) return current;
  return retained(held.current, swarm.dataUpdatedAt) ?? current;
}
type SetParams = ReturnType<typeof useSearchParams>[1];
function replaceSearch(setParams: SetParams, edit: (params: URLSearchParams) => void) {
  setParams(previous => {
    const next = new URLSearchParams(previous);
    edit(next);
    return next;
  }, { replace: true });
}
type Shown = ReturnType<typeof useSelectedObject>;
function restoreFocus(stage: HTMLDivElement | null, trigger: HTMLElement | null) {
  if (trigger && stage?.firstElementChild?.contains(trigger)) trigger.focus();
  else stage?.focus();
}
function focusNarrowPane(pane: HTMLElement | null) {
  if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023px)").matches) {
    pane?.scrollIntoView?.({ block: "start" });
    pane?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }
}
function useNavigation(shown: Shown, setParams: SetParams) {
  const pane = useRef<HTMLElement>(null);
  const focusPane = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const workerTrigger = useRef<HTMLElement | null>(null);
  const restoreWorkerFocus = useRef(false);
  const select = (s: Selection) => {
    if (s.kind === "node") workerTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusPane.current = true;
    replaceSearch(setParams, params => params.set("select", selectionId(s)));
  };
  // On a narrow viewport the pane is below the tree: bring it into view and move focus to its heading.
  useEffect(() => {
    if (restoreWorkerFocus.current && !shown.selection) {
      restoreWorkerFocus.current = false;
      restoreFocus(stage.current, workerTrigger.current);
      workerTrigger.current = null;
    }
    if (!focusPane.current || !shown.selection) return;
    focusPane.current = false;
    focusNarrowPane(pane.current);
  });
  const clear = () => replaceSearch(setParams, params => { params.delete("select"); params.delete("focus"); });
  const closeWorker = () => { restoreWorkerFocus.current = true; clear(); };
  return { pane, stage, select, clear, closeWorker };
}
function viewMode(value: string | null) { return value === "tree" || value === "board" ? value : null; }
function readMode(key: string) {
  try { return viewMode(localStorage.getItem(key)); } catch { return null; }
}
function rememberMode(key: string, mode: SwarmViewMode) {
  try { localStorage.setItem(key, mode); } catch { /* Links and in-memory selection still work. */ }
}
function useViewMode(principal: string, params: URLSearchParams, setParams: SetParams) {
  const modeKey = `aq.swarm.view:${principal}`;
  const [storedMode, setStoredMode] = useState<SwarmViewMode | null>(null);
  useEffect(() => { setStoredMode(readMode(modeKey)); }, [modeKey]);
  const mode: SwarmViewMode = viewMode(params.get("view")) ?? storedMode ?? "tree";
  const setMode = (next: SwarmViewMode) => {
    setStoredMode(next);
    rememberMode(modeKey, next);
    replaceSearch(setParams, params => params.set("view", next));
  };
  return { mode, setMode };
}
type CoverageReport = NonNullable<GraphData["swarm"]["data"]>["coverage"];
function coverageReason(coverage: CoverageReport | undefined, view: SwarmView | undefined) {
  if (coverage?.state !== "partial" || !coverage.reason) return null;
  if (coverage.reason !== "Some online workers advertise no slot total") return coverage.reason;
  const complete = view?.machines.every(machine => machine.nodes.every(node => node.health !== "online" || node.slots.total !== null));
  return complete ? null : coverage.reason;
}
function Coverage({ data }: { data: GraphData }) {
  const { view, swarm, now, stale } = data;
  const reason = coverageReason(swarm.data?.coverage, view);
  return <>
    {reason && <p className={styles.coverage}>{reason}</p>}
    {stale && swarm.data && <p role="status" className={styles.coverage}>Stale: the latest refresh failed. Last updated {now ? formatAge(now, swarm.data.serverTime) : "earlier"}.</p>}
  </>;
}
type Navigation = ReturnType<typeof useNavigation>;
function Summary({ data, mode, onMode }: { data: GraphData; mode: SwarmViewMode; onMode: (mode: SwarmViewMode) => void }) {
  if (!data.view) return null;
  return <SwarmSummary view={data.view} anchor={data.anchor} mode={mode} onMode={onMode} stale={data.stale} />;
}
function SwarmCanvas({ data, mode, shown, navigation }: { data: GraphData; mode: SwarmViewMode; shown: Shown; navigation: Navigation }) {
  const { swarm, view, ready, anchor, stale } = data;
  const { clear, select } = navigation;
  if (!view) return <div className={styles.flow}><QueryStatus status={swarm.isError ? "error" : "pending"} error={swarm.error} label="the swarm" onRetry={() => void swarm.refetch()} /></div>;
  return mode === "board" ? <SlotBoard view={view} anchor={anchor} selected={shown.selection} onSelect={select} /> :
    <SwarmTree view={view} ready={ready} selected={shown.selection} stale={stale} onSelect={select} onClear={clear} anchor={anchor} />;
}
function present(value: boolean) { return value || undefined; }
type StageLayout = { split: ReturnType<typeof useSwarmSplit>; mode: SwarmViewMode; paneClosed: boolean; desktop: boolean; focused: boolean; agent: boolean };
function stageLayout({ split, mode, paneClosed, desktop, focused, agent }: StageLayout) {
  const style = split.interactive && !paneClosed ? { "--swarm-tree-width": split.treePercent / 100 } as CSSProperties : undefined;
  return {
    style, "data-view": mode, "data-pane-closed": present(paneClosed), "data-resizing": present(split.dragging),
    "data-viewport-fit": present(desktop || focused), "data-wide": present(agent), "data-focus": present(focused),
  };
}
function paneState(selection: Selection | null, view: SwarmView | undefined, params: URLSearchParams) {
  const agent = selection?.kind === "agent";
  const focused = agent && params.get("focus") === "terminal";
  return { agent, focused, paneClosed: !selection && !!view };
}
function SwarmPageBody() {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const selectParam = params.get("select");
  const data = useGraphData(selectParam);
  const { cap, principal, view, ready } = data;
  const shown = useSelectedObject(data, selectParam);
  const navigation = useNavigation(shown, setParams);
  const { pane, stage, closeWorker } = navigation;
  const { mode, setMode } = useViewMode(principal, params, setParams);
  const { agent, focused, paneClosed } = paneState(shown.selection, view, params);
  const split = useSwarmSplit({ stage, principal, enabled: cap.enabled, desktop, focused, agent });
  if (!cap.enabled) return <><AgentsTabs current="swarm" /><p role="note">Swarm is not available on this server. <Link to={{ pathname: "/agents/history", search }}>Open History</Link></p></>;
  return <>
    <AgentsTabs current="swarm" />
    <Coverage data={data} />
    <SwarmStatusHeader />
    <Summary data={data} mode={mode} onMode={setMode} />
    <div ref={stage} tabIndex={-1} className={styles.stage} {...stageLayout({ split, mode, paneClosed, desktop, focused, agent })}>
      <SwarmCanvas data={data} mode={mode} shown={shown} navigation={navigation} />
      <SwarmDivider split={split} />
      <aside ref={pane} className={styles.pane} data-worker={present(shown.selection?.kind === "node")} aria-label="Properties">{shown.view && <SwarmPane view={shown.view} selection={shown.selection} ready={ready} note={shown.note} onCloseWorker={closeWorker} />}</aside>
    </div>
  </>;
}
