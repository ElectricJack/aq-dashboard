import { useLocation } from "react-router";
import { isProtectedReadFailure } from "../../../api/client";
import { useManualAgents } from "../swarm/manualAgents";
import { Pane } from "./TerminalPane";
import { Launch } from "./TerminalLauncher";
import { validIds, rosterRows, savedRow, visibleRows, type Row } from "./terminalRows";
import { useRef, useState } from "react";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Swarm } from "../../../api/wire/swarm";
import { PANEL_READ, useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import { useDraft } from "../../../app/useDraft";
import { AgentsTabs } from "../AgentsTabs";
import styles from "./TerminalWorkspace.module.css";

export function TerminalWorkspace() {
  const manual = useManualAgents();
  const { queryContext } = useSession();
  return <Workspace key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${manual?.project ?? "all"}`} />;
}
function useRoster() {
  const manual = useManualAgents();
  const { bootstrap } = useSession();
  const project = manual?.project ?? null;
  const swarm = useRead<Swarm, SwarmView>({
    resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS,
    enabled: bootstrap.capability("swarm.read").enabled, meta: PANEL_READ,
  });
  const assembled = rosterRows(swarm.data?.view, manual?.fleet, project);
  return {
    ...assembled, project, manualRefused: isProtectedReadFailure(manual?.error), manualError: !!manual?.error,
    swarmError: swarm.isError, loading: !manual?.fleet && swarm.isPending,
  };
}
type Roster = ReturnType<typeof useRoster>;
function usePanes({ project, rows, manualRefused }: Roster) {
  const [ids, setIds] = useDraft<string[]>(`terminal-panes:${project ?? "all"}`, [], validIds);
  const [focused, setFocused] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Record<string, Row>>({});
  for (const row of rows) known.current[row.key] = row;
  const active = ids.map(key => savedRow(key, known.current, manualRefused));
  const selected = focused && ids.includes(focused) ? focused : ids[0] ?? null;
  const full = ids.length >= 4;
  function open(row: Row) {
    if (!ids.includes(row.key)) {
      if (full) { setError("Close a pane before adding another agent."); return; }
      setIds([...ids, row.key]);
    }
    known.current[row.key] = row;
    setFocused(row.key);
    setError(null);
    setDrawer(false);
  }
  function close(id: string) {
    setIds(current => current.filter(key => key !== id));
    if (expanded === id) setExpanded(null);
  }
  function selectPane(id: string) {
    setFocused(id);
    if (expanded) setExpanded(id);
  }
  return { active, selected, ids, full, open, close, error, setError, expanded, setExpanded, setFocused, selectPane, drawer, setDrawer };
}
type Panes = ReturnType<typeof usePanes>;
function matchesFilter(row: Row, filter: string) {
  return `${row.project} ${row.worker} ${row.model}`.toLowerCase().includes(filter.toLowerCase());
}
function RosterRow({ row, selected, added, open, close }: { row: Row; selected: boolean; added: boolean } & Pick<Panes, "open" | "close">) {
  const action = added ? { verb: "Remove", direction: "from", symbol: "−", toggle: () => close(row.key) }
    : { verb: "Add", direction: "to", symbol: "+", toggle: () => open(row) };
  return <div className={styles.row} data-selected={selected || undefined}>
    <button className={styles.rowMain} onClick={() => open(row)}><strong>{row.project}</strong><span>{row.status} · {row.worker}</span><small>{row.model || "Model unavailable"}</small></button>
    <button aria-label={`${action.verb} ${row.project} ${action.direction} workspace`} onClick={action.toggle}>{action.symbol}</button>
  </div>;
}
function emptyRoster(roster: Roster, shownRows: Row[]) {
  if (shownRows.length) return null;
  if (roster.manualError || roster.swarmError) return null;
  return roster.loading ? "Loading agents…" : "No agents in this scope. Launch an agent to get started.";
}
function RosterLauncher({ panes, workerNames }: { panes: Panes; workerNames: Roster["workerNames"] }) {
  const [launching, setLaunching] = useState(false);
  const { full } = panes;
  return <>
    <div className={styles.rosterHead}><strong>Agents</strong><button disabled={!launching && full} title={full ? "Close a pane before launching another agent" : undefined} onClick={() => setLaunching(!launching)}>{launching ? "Cancel" : "Launch agent"}</button></div>
    {launching && <Launch workerNames={workerNames} onLaunch={row => { panes.open(row); setLaunching(false); }} onError={panes.setError} />}
  </>;
}
function RosterPanel({ roster, panes }: { roster: Roster; panes: Panes }) {
  const { ids, drawer, active, selected, open, close } = panes;
  const [filter, setFilter] = useState("");
  const shownRows = visibleRows(roster.rows, active);
  const emptyMessage = emptyRoster(roster, shownRows);
  return <aside className={styles.roster} data-open={drawer || undefined} aria-label="Agent roster">
    <RosterLauncher panes={panes} workerNames={roster.workerNames} />
    <label className={styles.search}>Search agents<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search" /></label>
    {roster.manualError && <p role="alert">Interactive agents could not be loaded.</p>}
    {roster.swarmError && <p role="alert">The worker roster is unavailable.</p>}
    {shownRows.filter(r => matchesFilter(r, filter)).map(row => <RosterRow key={row.key} row={row} selected={selected === row.key} added={ids.includes(row.key)} open={open} close={close} />)}
    {emptyMessage && <p>{emptyMessage}</p>}
  </aside>;
}
function PaneSwitcher({ panes }: { panes: Panes }) {
  const { active, selected, selectPane } = panes;
  if (active.length < 2) return null;
  return <nav className={styles.switcher} aria-label="Open terminals">{active.map(r => <button key={r.key} aria-pressed={selected === r.key} onClick={() => selectPane(r.key)}>{r.project}</button>)}</nav>;
}
function PaneGrid({ roster, panes }: { roster: Roster; panes: Panes }) {
  const { search } = useLocation();
  const { project, rows } = roster;
  const { error, active, selected, expanded, setFocused, setExpanded, close } = panes;
  return <div className={styles.output}>
    {error && <p role="alert">{error}</p>}
    <PaneSwitcher panes={panes} />
    {!active.length && <div className={styles.empty}>Select an agent to open its terminal.</div>}
    <div className={styles.grid} data-count={active.length} data-expanded={!!expanded}>
      {active.map(row => <Pane
        key={row.key} row={row} selected={selected === row.key} hidden={!!expanded && expanded !== row.key}
        narrowHidden={selected !== row.key} expanded={expanded === row.key} project={project}
        present={rows.some(r => r.key === row.key)} onFocus={() => setFocused(row.key)}
        onExpand={() => setExpanded(expanded === row.key ? null : row.key)} onClose={() => close(row.key)} search={search}
      />)}
    </div>
  </div>;
}
function Workspace() {
  const roster = useRoster();
  const panes = usePanes(roster);
  const { active, drawer, setDrawer } = panes;
  return <>
    <AgentsTabs current="terminals" />
    <div className={styles.workspace} data-viewport-fit data-terminal-workspace data-has-panes={active.length > 0 || undefined}>
      <button className={styles.rosterToggle} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>Agents {drawer ? "×" : "☰"}</button>
      <RosterPanel roster={roster} panes={panes} />
      <PaneGrid roster={roster} panes={panes} />
    </div>
  </>;
}
