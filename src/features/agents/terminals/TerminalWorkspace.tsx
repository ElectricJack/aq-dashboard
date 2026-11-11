import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { transcript } from "../../../api/sessionHistory";
import { adaptSwarm, SWARM_POLL_MS, type SwarmView } from "../../../api/adapters/swarm";
import type { Swarm } from "../../../api/wire/swarm";
import { PANEL_READ, useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import { useDraft } from "../../../app/useDraft";
import { AgentsTabs } from "../AgentsTabs";
import { InteractiveTerminal } from "../InteractiveTerminal";
import { useManualAgents } from "../swarm/manualAgents";
import styles from "./TerminalWorkspace.module.css";

type Row = { key: string; id: string; project: string; projectId: string; worker: string; model: string; status: string; terminal: string | null; manual: boolean };
const validIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 4 && v.every(x => typeof x === "string" && /^(manual|native):.{1,256}$/.test(x)) && new Set(v).size === v.length;

export function TerminalWorkspace() {
  const manual = useManualAgents();
  const { queryContext } = useSession();
  return <Workspace key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${manual?.project ?? "all"}`} />;
}
function Workspace() {
  const manual = useManualAgents();
  const { bootstrap } = useSession();
  const { search } = useLocation();
  const project = manual?.project ?? null;
  const [ids, setIds] = useDraft<string[]>(`terminal-panes:${project ?? "all"}`, [], validIds);
  const [focused, setFocused] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false), [filter, setFilter] = useState(""), [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = useRef<Record<string, Row>>({});
  const swarm = useRead<Swarm, SwarmView>({ resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: SWARM_POLL_MS, enabled: bootstrap.capability("swarm.read").enabled, meta: PANEL_READ });
  const native: Row[] = swarm.data?.view.machines.flatMap(m => m.nodes.flatMap(n => n.agents.filter(a => !project || a.project.id === project).map(a => ({ key: `native:${a.sessionId}`, id: a.sessionId, project: a.task?.title ?? a.project.label, projectId: a.project.id, worker: n.name, model: [a.provider, a.model].filter(Boolean).join(" · "), status: "Running", terminal: a.terminalId, manual: false })))) ?? [];
  const manualRows: Row[] = manual?.fleet?.sessions.map(a => ({ key: `manual:${a.id}`, id: a.id, project: a.spec.project_name, projectId: a.project_id, worker: a.node_id, model: [a.spec.provider, a.spec.model].filter(Boolean).join(" · "), status: a.status, terminal: a.id, manual: true })) ?? [];
  const rows = [...manualRows, ...native];
  for (const row of rows) known.current[row.key] = row;
  const active = ids.map(id => known.current[id]).filter((r): r is Row => !!r && (!project || r.projectId === project));
  const selected = focused && ids.includes(focused) ? focused : ids[0] ?? null;
  function open(row: Row) {
    if (!ids.includes(row.key)) {
      if (ids.length >= 4) { setError("Close a pane before adding another agent."); return; }
      setIds([...ids, row.key]);
    }
    setFocused(row.key); setError(null); setDrawer(false);
  }
  function close(id: string) { setIds(ids.filter(x => x !== id)); if (expanded === id) setExpanded(null); }
  const shownRows = [...rows.filter(r => !["stopped", "failed"].includes(r.status)), ...active.filter(r => ["stopped", "failed"].includes(r.status) && !rows.some(x => x.key === r.key && !["stopped", "failed"].includes(x.status)))];
  return <>
    <AgentsTabs current="terminals" />
    <div className={styles.workspace}>
      <button className={styles.rosterToggle} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>Agents {drawer ? "×" : "☰"}</button>
      <aside className={styles.roster} data-open={drawer || undefined} aria-label="Agent roster">
        <div className={styles.rosterHead}><strong>Agents</strong><button disabled={!launching && ids.length >= 4} title={ids.length >= 4 ? "Close a pane before launching another agent" : undefined} onClick={() => setLaunching(!launching)}>{launching ? "Cancel" : "Launch agent"}</button></div>
        {launching && <Launch onLaunch={id => { open({ key: `manual:${id}`, id, project: "Starting agent", projectId: project ?? "", worker: "", model: "", status: "pending", terminal: id, manual: true }); setLaunching(false); }} />}
        <label className={styles.search}>Search agents<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search" /></label>
        {error && <p role="alert">{error}</p>}
        {shownRows.filter(r => `${r.project} ${r.worker} ${r.model}`.toLowerCase().includes(filter.toLowerCase())).map(row => <div className={styles.row} key={row.key} data-selected={selected === row.key || undefined}>
          <button className={styles.rowMain} onClick={() => open(row)}><strong>{row.project}</strong><span>{row.status} · {row.worker}</span><small>{row.model || "Model unavailable"}</small></button>
          <button aria-label={`${ids.includes(row.key) ? "Remove" : "Add"} ${row.project} ${ids.includes(row.key) ? "from" : "to"} workspace`} onClick={() => ids.includes(row.key) ? close(row.key) : open(row)}>{ids.includes(row.key) ? "−" : "+"}</button>
        </div>)}
        {!shownRows.length && <p>No agents in this scope. Launch an agent to get started.</p>}
      </aside>
      <main className={styles.output}>
        {active.length > 1 && <nav className={styles.switcher} aria-label="Open terminals">{active.map(r => <button key={r.key} aria-pressed={selected === r.key} onClick={() => setFocused(r.key)}>{r.project}</button>)}</nav>}
        {!active.length && <div className={styles.empty}>Select an agent to open its terminal.</div>}
        <div className={styles.grid} data-count={active.length} data-expanded={!!expanded}>
          {active.map(row => <Pane key={row.key} row={row} selected={selected === row.key} hidden={!!expanded && expanded !== row.key} narrowHidden={selected !== row.key} expanded={expanded === row.key} onFocus={() => setFocused(row.key)} onExpand={() => setExpanded(expanded === row.key ? null : row.key)} onClose={() => close(row.key)} search={search} />)}
        </div>
      </main>
    </div>
  </>;
}
function Pane({ row, selected, hidden, narrowHidden, expanded, onFocus, onExpand, onClose, search }: { row: Row; selected: boolean; hidden: boolean; narrowHidden: boolean; expanded: boolean; onFocus: () => void; onExpand: () => void; onClose: () => void; search: string }) {
  const manual = useManualAgents();
  const [started, setStarted] = useState(row.status === "running" || !row.manual);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (row.status === "running") setStarted(true); }, [row.status]);
  const ended = row.status === "stopped" || row.status === "failed";
  const { queryContext } = useSession();
  const archive = useQuery({ queryKey: ["pane-transcript", queryContext.principalId, queryContext.authorizationRevision, row.id], queryFn: ({signal}) => transcript(row.id, {limit: 32}, signal), enabled: ended && row.manual, retry: false, refetchInterval: q => q.state.data && ["recording", "finalizing"].includes(q.state.data.session.archive.state) ? 3000 : false, meta: PANEL_READ });
  const saved = archive.data && archive.data.session.archive.state === "complete" && !archive.data.has_more && archive.data.chunks.length > 0 ? archive.data.chunks.map(c => c.text).join("") : null;
  const archiveState = archive.data?.session.archive.state;
  const historyParams = new URLSearchParams(search); historyParams.set("session", `${row.manual ? "manual" : "native"}:${row.id}`);
  return <section className={styles.pane} data-selected={selected || undefined} data-hidden={hidden || undefined} data-narrow-hidden={narrowHidden || undefined} onFocusCapture={onFocus} onClick={onFocus} aria-label={`${row.project} terminal`}>
    <header className={styles.paneHead}><strong>{row.project}</strong><span>{row.status}</span><button onClick={onExpand}>{expanded ? "Restore" : "Expand"}</button>{row.manual && !ended && <button disabled={row.status === "stopping"} onClick={() => void manual?.stop(row.id).catch(() => setError("Stop could not be confirmed."))}>Stop</button>}<button onClick={onClose} aria-label={`Close ${row.project} pane`}>Close</button></header>
    {error && <p role="alert">{error}</p>}
    {ended && <div className={styles.ended} role="status">{row.status === "failed" ? "Failed" : "Ended"} · {archiveState === "not_recorded" ? "Not recorded" : archiveState === "complete" ? "Saved transcript" : archive.isError ? "Saved transcript unavailable" : "Saving final output"}. <Link to={{ pathname: "/agents/history", search: `?${historyParams}` }}>History</Link></div>}
    {saved && <pre className={styles.transcript} aria-label="Terminal transcript">{saved}</pre>}
    <div className={styles.live} hidden={!!saved}>{started && row.terminal ? <InteractiveTerminal terminalId={row.terminal} name={row.key} label={`${row.project} terminal output`} manual={row.manual} inputEnabled={!ended} compact /> : <p className={styles.empty}>{ended ? "No live output was observed." : row.terminal ? "Starting agent…" : "No terminal is available for this session."}</p>}</div>
  </section>;
}
function Launch({ onLaunch }: { onLaunch: (id: string) => void }) {
  const manual = useManualAgents();
  const [worker, setWorker] = useState(""), [project, setProject] = useState(""), [provider, setProvider] = useState(""), [profile, setProfile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fleet = manual?.fleet;
  const w = fleet?.workers.find(x => x.node_id === worker) ?? fleet?.workers[0];
  const projects = fleet?.projects.filter(p => w?.repositories.includes(p.repository_id) && (!manual?.project || p.id === manual.project)) ?? [];
  const p = projects.find(x => x.id === project) ?? projects[0];
  const providers = w?.providers ?? [];
  const selectedProvider = providers.includes(provider) ? provider : providers[0];
  const profiles = fleet?.launch_profiles.filter(x => x.provider === selectedProvider) ?? [];
  const key = (x: typeof profiles[number]) => `${x.profile_id}@${x.profile_version}:${x.candidate_id}`;
  const choice = profiles.find(x => key(x) === profile) ?? profiles.find(x => x.profile_id === "standard-medium") ?? profiles[0];
  function launch() {
    if (!manual || !w || !p || !choice) return;
    const id = crypto.randomUUID();
    const request = manual.launch(w.node_id, p.id, id, { profile_id: choice.profile_id, profile_version: choice.profile_version, candidate_id: choice.candidate_id });
    onLaunch(id);
    void request.catch(() => setError("Launch could not be confirmed. Check the agent status."));
  }
  return <div className={styles.launch}>
    <label>Worker<select value={w?.node_id ?? ""} onChange={e => setWorker(e.target.value)}>{fleet?.workers.map(x => <option key={x.node_id} value={x.node_id}>{x.node_id}</option>)}</select></label>
    <label>Project<select value={p?.id ?? ""} onChange={e => setProject(e.target.value)}>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label>Provider<select value={selectedProvider ?? ""} onChange={e => setProvider(e.target.value)}>{providers.map(x => <option key={x} value={x}>{x === "openai" ? "Codex" : "Claude"}</option>)}</select></label>
    <label>Profile<select value={choice ? key(choice) : ""} onChange={e => setProfile(e.target.value)}>{profiles.map(x => <option key={key(x)} value={key(x)}>{x.name} · {x.model}</option>)}</select></label>
    <button disabled={!w || !p || !choice} onClick={launch}>Start agent</button>{error && <p role="alert">{error}</p>}
  </div>;
}
