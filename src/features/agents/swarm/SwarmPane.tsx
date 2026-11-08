import { Link, useLocation } from "react-router";
import type { HoldReasonView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { ActionButton, DetailList } from "../../../components/layout/Workspace";
import { useProjects } from "../../../app/useProjects";
import { useProviderUsage } from "../../../app/useProviderUsage";
import { useSession } from "../../../app/session";
import { AgentPane, scopeOnly } from "./AgentPane";
import { showWaiting, type Selection } from "./graph";
import styles from "./Swarm.module.css";

const gb = (bytes: number, base: number) => String(Math.round(bytes / base));
const holdLine = (h: HoldReasonView) => (h.remedy ? `${h.message} — ${h.remedy}` : h.message);

function Head({ kicker, title }: { kicker: string; title: string }) {
  return <div className={styles.paneHead}><div className={styles.kicker}>{kicker}</div><h2 className={styles.paneTitle} tabIndex={-1}>{title}</h2></div>;
}
function Holding({ holds }: { holds: HoldReasonView[] }) {
  if (holds.length === 0) return null;
  return <><dt>Holding</dt><dd>{holds.map(h => <div key={h.code}>{holdLine(h)}</div>)}</dd></>;
}
function Settings({ label }: { label: string }) {
  const { search } = useLocation();
  return <Link className={styles.linkButton} to={{ pathname: "/settings", search: scopeOnly(search) }}>{label}</Link>;
}
function WorkerControls({ labels }: { labels: string[] }) {
  const { bootstrap } = useSession();
  const enabled = bootstrap.capability("swarm.worker.control").enabled;
  return <>
    <div className={styles.actions}>{labels.map(l => <ActionButton key={l} disabled={!enabled}>{l}</ActionButton>)}</div>
    {!enabled && <p className={styles.actionNote}>Worker start, stop and drain are not available on this server yet.</p>}
  </>;
}

function ServerPane({ view, ready }: { view: SwarmView; ready: number | null }) {
  const usage = useProviderUsage();
  const projects = useProjects();
  const waitingShown = showWaiting(view, ready);
  const usageText = usage.state.status === "ready" && usage.state.data.providers.length > 0
    ? usage.state.data.providers.map(p => `${p.providerId} ${p.windows.find(w => w.id === p.preferredWindowId)?.usedPercent ?? "unknown"}%`).join(" · ") : "unavailable";
  return <>
    <Head kicker="AQ server" title={window.location.host} />
    <DetailList className={styles.facts}>
      <dt>Health</dt><dd>{`ok · v${view.server.version} · ${view.server.sourceRevision.slice(0, 8)}`}</dd>
      <dt>Ready tasks</dt><dd>{`${ready ?? "unknown"}`}{waitingShown ? ` (${view.waiting.agents.length || ready} waiting for a slot)` : ""}</dd>
      <dt>Running agents</dt><dd>{view.server.runningAgents ?? "—"}</dd>
      <dt>Usage window</dt><dd>{usageText}</dd>
      <dt>Projects</dt><dd>{projects.data?.view.length ? projects.data.view.map(p => p.label).join(", ") : "unavailable"}</dd>
    </DetailList>
    <div className={styles.actions}><Settings label="Open settings" /></div>
  </>;
}

function stateText(m: MachineView): string {
  switch (m.state) {
    case "online": return "online";
    case "holding": return `holding: ${m.holding.map(h => h.message).join("; ")}`;
    case "offline": return m.lastSeenAt ? `offline since ${new Date(m.lastSeenAt).toLocaleString()}` : "offline";
    case "stopped": return "stopped";
    case "booting": return "booting";
    default: return "state unknown";
  }
}

function MachinePane({ m, serverTime }: { m: MachineView; serverTime: string }) {
  const l = m.load;
  const offline = m.nodes.filter(n => n.health !== "online").length;
  return <>
    <Head kicker={m.kind === "cloud" ? "Cloud machine (boat VM)" : m.kind === "local" ? "Local machine" : "Machine"} title={m.label} />
    <DetailList className={styles.facts}>
      <dt>State</dt><dd>{stateText(m)}</dd>
      <dt>Load now</dt><dd>{l ? `CPU ${l.cpuPercent}% · RAM ${l.memoryPercent}%${l.fresh ? "" : ` (as of ${formatAge(serverTime, l.observedAt)})`}` : "—"}</dd>
      <dt>Load avg</dt><dd>{l ? l.cpuAvgPercent === null && l.memoryAvgPercent === null ? "—" : `CPU ${l.cpuAvgPercent === null ? "—" : `${l.cpuAvgPercent}%`} · RAM ${l.memoryAvgPercent === null ? "—" : `${l.memoryAvgPercent}%`} (last 15 min)` : "—"}</dd>
      <dt>Load source</dt><dd>{l ? (l.source === "windows_host" ? "Windows host (WSL2)" : l.source === "linux" ? "Linux" : "unknown") : "unknown"}</dd>
      {l && (l.hostProbe === "stale" || l.hostProbe === "missing") && <><dt>Note</dt><dd>{`Windows host probe ${l.hostProbe}: showing WSL VM load`}</dd></>}
      <dt>Max agents</dt><dd>{m.agentMax ?? "unknown"} <Settings label="Edit in Settings" /></dd>
      <dt>Cores / RAM</dt><dd>{m.hardware ? `${m.hardware.logicalCpus ?? "—"} / ${gb(m.hardware.memoryTotalBytes, 2 ** 30)} GB` : "unknown"}</dd>
      <dt>Disk free</dt><dd>{m.hardware?.diskFreeBytes != null ? `${gb(m.hardware.diskFreeBytes, 1e9)} GB` : "unknown"}</dd>
      <dt>Worker nodes</dt><dd>{m.nodes.length}{offline > 0 ? ` (${offline} offline)` : ""}</dd>
      {m.kind === "cloud" && <><dt>Cost</dt><dd>{m.cost ? `$${(m.cost.microsPerHour / 1e6).toFixed(2)} / h · up ${formatAge(serverTime, m.cost.startedAt).replace(/ ago$/, "")}` : "—"}</dd></>}
      <Holding holds={m.holding} />
    </DetailList>
    <WorkerControls labels={["Start worker", "Stop worker", "Drain"]} />
  </>;
}

function NodePane({ n, serverTime }: { n: NodeView; serverTime: string }) {
  return <>
    <Head kicker="Worker node" title={n.name} />
    <DetailList className={styles.facts}>
      <dt>Backend</dt><dd>{n.backendKind ?? "unknown"}</dd>
      <dt>Slots</dt><dd>{`${n.slots.occupied}/${n.slots.total ?? "?"} slots`}</dd>
      <dt>Heartbeat</dt><dd>{n.lastSeenAt ? formatAge(serverTime, n.lastSeenAt) : "never"}</dd>
      <dt>Service</dt><dd>{n.service === "unreported" ? "not reported" : n.service}</dd>
      <dt>Version</dt><dd>{`aq-worker ${n.workerVersion}`}</dd>
      <dt>Sandbox image</dt><dd>{n.sandboxTemplates.length ? n.sandboxTemplates.map(t => <div key={t}>{`${t.slice(0, 13)}…`}</div>) : "none advertised"}</dd>
      <dt>Channel</dt><dd>{n.agentChannel === "ready" ? "agent channel ready" : n.agentChannel === "unavailable" ? "agent channel unavailable" : "not reported"}</dd>
      <Holding holds={n.holding} />
    </DetailList>
    <WorkerControls labels={["Drain node", "Restart", "View logs"]} />
  </>;
}

function find(view: SwarmView, selection: Selection) {
  for (const m of view.machines) for (const n of m.nodes) {
    if (selection.kind === "node" && n.id === selection.nodeId) return { m, n };
    if (selection.kind === "free" && n.id === selection.nodeId) return { m, n };
    if (selection.kind === "agent") { const a = n.agents.find(x => x.sessionId === selection.sessionId); if (a) return { m, n, a }; }
  }
  if (selection.kind === "machine") { const m = view.machines.find(x => x.id === selection.machineId); if (m) return { m }; }
  return null;
}

function Empty() {
  return <>
    <Head kicker="Properties" title="Select anything in the tree" />
    <DetailList className={styles.facts}>
      <dt>Server</dt><dd>health, version, queue depth</dd>
      <dt>Machine</dt><dd>cores, memory, disk, load</dd>
      <dt>Worker node</dt><dd>slots, heartbeat, backend</dd>
      <dt>Agent</dt><dd>opens its live terminal</dd>
    </DetailList>
  </>;
}

export function SwarmPane({ view, selection, ready, autoControlled, note }: { view: SwarmView; selection: Selection | null; ready: number | null; autoControlled: Set<string>; note?: string | null }) {
  if (!selection) return <Empty />;
  return <>{note && <p role="note" className={styles.actionNote}>{note}</p>}<Body view={view} selection={selection} ready={ready} autoControlled={autoControlled} /></>;
}

function Body({ view, selection, ready, autoControlled }: { view: SwarmView; selection: Selection; ready: number | null; autoControlled: Set<string> }) {
  if (selection.kind === "server") return <ServerPane view={view} ready={ready} />;
  if (selection.kind === "waiting") {
    const n = view.waiting.agents.length || ready || 0;
    return <>
      <Head kicker="Waiting" title={`${n} waiting`} />
      <DetailList className={styles.facts}>
        <dt>Why</dt><dd>{view.waiting.reasons.map(r => <div key={r.code}>{r.message}</div>)}</dd>
        <dt>Fix</dt><dd>{view.waiting.reasons.filter(r => r.remedy).map(r => <div key={r.code}>{r.remedy}</div>)}</dd>
      </DetailList>
    </>;
  }
  if (selection.kind === "waitingAgent") {
    const w = view.waiting.agents.find(x => x.taskId === selection.taskId);
    if (!w) return <Empty />;
    return <>
      <Head kicker="Waiting agent" title={w.title} />
      <DetailList className={styles.facts}>
        <dt>Why</dt><dd>{w.reasons.map(r => r.message).join("; ")}</dd>
        <dt>Fix</dt><dd>{w.reasons.flatMap(r => (r.remedy ? [r.remedy] : [])).join("; ")}</dd>
      </DetailList>
    </>;
  }
  const hit = find(view, selection);
  if (!hit) return <Empty />;
  if (selection.kind === "machine") return <MachinePane m={hit.m} serverTime={view.serverTime} />;
  if (selection.kind === "node" && hit.n) return <NodePane n={hit.n} serverTime={view.serverTime} />;
  if (selection.kind === "free" && hit.n) {
    const hold = hit.m.state === "holding" ? hit.m.holding[0] : undefined;
    return <>
      <Head kicker="Free slot" title="waiting for ready work" />
      <DetailList className={styles.facts}>
        <dt>Node</dt><dd>{hit.n.name}</dd>
        <dt>Takes</dt><dd>any provider and class allowed on this node</dd>
        {hold && <><dt>Why</dt><dd>{`Free, but this machine is holding back: ${hold.message}`}</dd>{hold.remedy && <><dt>Fix</dt><dd>{hold.remedy}</dd></>}</>}
      </DetailList>
    </>;
  }
  if (selection.kind === "agent" && hit.a) {
    return <>
      <Head kicker={`Agent · ${hit.a.provider ?? "agent"} · ${hit.a.intelligenceClass ?? "unclassified"}`} title={hit.a.task?.title ?? "No task"} />
      <AgentPane agent={hit.a} serverTime={view.serverTime} autoControlled={autoControlled} />
    </>;
  }
  return <Empty />;
}
