import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { transcript } from "../../../api/sessionHistory";
import { adaptSessionDetail, type SessionDetailView } from "../../../api/adapters/inspection";
import type { SessionDetail } from "../../../api/wire/proposed";
import { ContractError } from "../../../api/adapters/contract";
import { ApiError } from "../../../api/client";
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
  const native: Row[] = swarm.data?.view.machines.flatMap(m => m.nodes.flatMap(n => n.agents.filter(a => !project || a.project.id === project).map(a => ({ key: `native:${a.sessionId}`, id: a.sessionId, project: a.task?.title ?? a.project.label, projectId: a.project.id, worker: n.name, model: [a.provider, a.model].filter(Boolean).join(" · "), status: "Listed in Swarm", terminal: a.terminalId, manual: false })))) ?? [];
  const workerNames = Object.fromEntries(swarm.data?.view.machines.flatMap(m => m.nodes.map(n => [n.id, n.name || m.label])) ?? []);
  const manualRows: Row[] = manual?.fleet?.sessions.map(a => ({ key: `manual:${a.id}`, id: a.id, project: a.spec.project_name, projectId: a.project_id, worker: workerNames[a.node_id] ?? "Worker unavailable", model: [a.spec.provider, a.spec.model].filter(Boolean).join(" · "), status: a.status, terminal: a.id, manual: true })) ?? [];
  const rows = [...manualRows, ...native];
  for (const row of rows) known.current[row.key] = row;
  const active = ids.map(key => known.current[key] ?? { key, id: key.slice(key.indexOf(":") + 1), project: "Saved agent", projectId: "", worker: "", model: "", status: "Loading", terminal: null, manual: key.startsWith("manual:") });
  const selected = focused && ids.includes(focused) ? focused : ids[0] ?? null;
  function open(row: Row) {
    if (!ids.includes(row.key)) {
      if (ids.length >= 4) { setError("Close a pane before adding another agent."); return; }
      setIds([...ids, row.key]);
    }
    known.current[row.key] = row;
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
        {launching && <Launch workerNames={workerNames} onLaunch={row => { open(row); setLaunching(false); }} onError={setError} />}
        <label className={styles.search}>Search agents<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search" /></label>
        {shownRows.filter(r => `${r.project} ${r.worker} ${r.model}`.toLowerCase().includes(filter.toLowerCase())).map(row => <div className={styles.row} key={row.key} data-selected={selected === row.key || undefined}>
          <button className={styles.rowMain} onClick={() => open(row)}><strong>{row.project}</strong><span>{row.status} · {row.worker}</span><small>{row.model || "Model unavailable"}</small></button>
          <button aria-label={`${ids.includes(row.key) ? "Remove" : "Add"} ${row.project} ${ids.includes(row.key) ? "from" : "to"} workspace`} onClick={() => ids.includes(row.key) ? close(row.key) : open(row)}>{ids.includes(row.key) ? "−" : "+"}</button>
        </div>)}
        {!shownRows.length && <p>No agents in this scope. Launch an agent to get started.</p>}
      </aside>
      <main className={styles.output}>
        {error && <p role="alert">{error}</p>}
        {active.length > 1 && <nav className={styles.switcher} aria-label="Open terminals">{active.map(r => <button key={r.key} aria-pressed={selected === r.key} onClick={() => setFocused(r.key)}>{r.project}</button>)}</nav>}
        {!active.length && <div className={styles.empty}>Select an agent to open its terminal.</div>}
        <div className={styles.grid} data-count={active.length} data-expanded={!!expanded}>
          {active.map(row => <Pane key={row.key} row={row} selected={selected === row.key} hidden={!!expanded && expanded !== row.key} narrowHidden={selected !== row.key} expanded={expanded === row.key} project={project} present={rows.some(r => r.key === row.key)} onFocus={() => setFocused(row.key)} onExpand={() => setExpanded(expanded === row.key ? null : row.key)} onClose={() => close(row.key)} search={search} />)}
        </div>
      </main>
    </div>
  </>;
}
function Pane({ row, selected, hidden, narrowHidden, expanded, project, present, onFocus, onExpand, onClose, search }: { row: Row; selected: boolean; hidden: boolean; narrowHidden: boolean; expanded: boolean; project: string | null; present: boolean; onFocus: () => void; onExpand: () => void; onClose: () => void; search: string }) {
  const manual = useManualAgents();
  const { queryContext } = useSession();
  const [error, setError] = useState<string | null>(null);
  const detail = useRead<SessionDetail, SessionDetailView>({ resource: "session", path: `/api/v1/sessions/${encodeURIComponent(row.id)}`, scope: project ? {kind:"project",project_id:project} : {kind:"all_authorized"}, enabled: !row.manual, pollMs: 5000, meta: PANEL_READ, adapt: (wire, time) => { if (wire.id !== row.id) throw new ContractError("Session identity changed"); return adaptSessionDetail(wire, time); } });
  const manualEnded = row.status === "stopped" || row.status === "failed";
  const archive = useQuery({ queryKey: ["pane-transcript", queryContext.principalId, queryContext.authorizationRevision, row.id], queryFn: ({signal}) => transcript(row.id, {limit: 32}, signal), enabled: row.manual && (manualEnded || row.status === "Loading" || !present), retry: false, refetchInterval: q => q.state.data && ["recording", "finalizing"].includes(q.state.data.session.archive.state) ? 3000 : false, meta: PANEL_READ });
  const manualSession = archive.data?.session;
  const nativeSession = detail.data?.view;
  const refusal = (e: unknown) => e instanceof ApiError && [401, 403, 404].includes(e.status ?? 0);
  const rejected = row.manual ? refusal(archive.error) : refusal(detail.error);
  const resolvedProject = row.manual ? manualSession?.project_id ?? row.projectId : nativeSession?.project.id ?? row.projectId;
  const outsideScope = !!project && !!resolvedProject && project !== resolvedProject;
  const permitted = !rejected && !outsideScope;
  const status = row.manual ? !present || row.status === "Loading" ? manualSession?.status ?? (row.status === "Loading" ? archive.isError ? "Unavailable" : "Loading" : row.status) : row.status : nativeSession ? nativeSession.lifecycle?.stoppedAt || nativeSession.observation.state === "reported_stopped" ? "stopped" : nativeSession.observation.state === "reported_running" ? `Running${nativeSession.observation.freshness === "stale" ? " (stale)" : ""}` : "State unknown" : row.status === "Loading" ? (detail.isError ? "Unavailable" : "Loading") : "State unknown";
  const ended = status === "stopped" || status === "failed";
  const terminalId = row.manual ? manualSession?.id ?? row.terminal : nativeSession?.terminal?.id ?? row.terminal;
  const title = row.manual ? manualSession?.spec.project_name ?? row.project : nativeSession?.task?.title ?? nativeSession?.label ?? row.project;
  const [started, setStarted] = useState(row.status === "running" || (!row.manual && !!row.terminal));
  useEffect(() => { if (terminalId && !ended && permitted && (row.manual ? status === "running" : status !== "Loading" && status !== "Unavailable")) setStarted(true); }, [terminalId, ended, permitted, status, row.manual]);
  const saved = ended && permitted && archive.data && archive.data.session.archive.state === "complete" && !archive.data.has_more && archive.data.chunks.length > 0 ? archive.data.chunks.map(c => c.text).join("") : null;
  const archiveState = archive.data?.session.archive.state;
  const historyParams = new URLSearchParams(search); historyParams.set("session", `${row.manual ? "manual" : "native"}:${row.id}`);
  return <section className={styles.pane} data-selected={selected || undefined} data-hidden={hidden || undefined} data-narrow-hidden={narrowHidden || undefined} onFocusCapture={onFocus} onClick={onFocus} aria-label={`${title} terminal`}>
    <header className={styles.paneHead}><strong>{title}</strong><span>{!permitted ? "Unavailable" : status}</span><button onClick={onExpand}>{expanded ? "Restore" : "Expand"}</button>{row.manual && permitted && !ended && status !== "Loading" && <button disabled={status === "stopping"} onClick={() => void manual?.stop(row.id).catch(() => setError("Stop could not be confirmed."))}>Stop</button>}<button onClick={onClose} aria-label={`Close ${title} pane`}>Close</button></header>
    {error && <p role="alert">{error}</p>}
    {!permitted && <p role="status" className={styles.empty}>This session is unavailable in this scope. Close this pane to free its slot.</p>}
    {permitted && ended && <div className={styles.ended} role="status">{status === "failed" ? "Failed" : "Ended"} · {row.manual ? archiveState === "not_recorded" ? "Not recorded" : archiveState === "complete" ? "Saved transcript" : archive.isError ? "Saved transcript unavailable" : "Saving final output" : "Native transcript availability is in History"}. <Link to={{ pathname: "/agents/history", search: `?${historyParams}` }}>History</Link></div>}
    {saved && <pre className={styles.transcript} aria-label="Terminal transcript">{saved}</pre>}
    {permitted && <div className={styles.live} hidden={!!saved}>{started && terminalId ? <InteractiveTerminal terminalId={terminalId} name={row.key} label={`${title} terminal output`} manual={row.manual} inputEnabled={!ended} compact /> : <p className={styles.empty}>{ended ? "No live output was observed." : (row.manual ? archive.isError && row.status === "Loading" : detail.isError && !nativeSession) ? "Session unavailable. You can close this pane or retry later." : terminalId ? "Starting agent…" : row.status === "Loading" ? "Loading session…" : "No terminal is available for this session."}</p>}</div>}
  </section>;
}

function Launch({ onLaunch, onError, workerNames }: { onLaunch: (row: Row) => void; onError: (message: string) => void; workerNames: Record<string, string> }) {
  const manual = useManualAgents();
  const [worker, setWorker] = useState(""), [project, setProject] = useState(""), [provider, setProvider] = useState(""), [profile, setProfile] = useState("");
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
    onLaunch({ key: `manual:${id}`, id, project: p.name, projectId: p.id, worker: workerNames[w.node_id] ?? "Worker unavailable", model: `${choice.provider} · ${choice.model}`, status: "pending", terminal: id, manual: true });
    void request.catch(() => onError("Launch could not be confirmed. Check the agent status."));
  }
  return <div className={styles.launch}>
    <label>Worker<select value={w?.node_id ?? ""} onChange={e => setWorker(e.target.value)}>{fleet?.workers.map(x => <option key={x.node_id} value={x.node_id}>{workerNames[x.node_id] ?? "Worker unavailable"}</option>)}</select></label>
    <label>Project<select value={p?.id ?? ""} onChange={e => setProject(e.target.value)}>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label>Provider<select value={selectedProvider ?? ""} onChange={e => setProvider(e.target.value)}>{providers.map(x => <option key={x} value={x}>{x === "openai" ? "Codex" : "Claude"}</option>)}</select></label>
    <label>Profile<select value={choice ? key(choice) : ""} onChange={e => setProfile(e.target.value)}>{profiles.map(x => <option key={key(x)} value={key(x)}>{x.name} · {x.model}</option>)}</select></label>
    <button disabled={!w || !p || !choice} onClick={launch}>Start agent</button>
  </div>;
}
