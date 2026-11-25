import { agentClassLabel } from "../../../api/adapters/swarm";
import { Link, useLocation } from "react-router";
import type { AgentView, HoldReasonView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { DetailList } from "../../../components/layout/Workspace";
import { useProjects } from "../../../app/useProjects";
import { useProviderUsage } from "../../../app/useProviderUsage";
import { AgentPane, scopeOnly } from "./AgentPane";
import { AddMachine } from "./AddMachine";
import { OwnerAvailability } from "./OwnerAvailability";
import { MachineControls } from "./MachineControls";
import { WorkerManagement } from "./WorkerManagement";
import { WorkerInspector } from "./WorkerInspector";
import { HELD_TEXT, showWaiting, type Selection } from "./graph";
import { taskLabel } from "./slots";
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
function availabilityText(view: SwarmView): string {
  const a = view.server.ownerAvailability;
  if (!a) return "unknown";
  if (a.state === "on") return a.since ? `On (kept on since ${formatAge(view.serverTime, a.since)})` : "On";
  return a.state === "off" ? "Off" : "Not kept on";
}

function ServerPane({ view, ready }: { view: SwarmView; ready: number | null }) {
  const usage = useProviderUsage();
  const projects = useProjects();
  const waitingShown = showWaiting(view, ready);
  const usageText = usage.state.status === "ready" && usage.state.data.providers.length > 0
    ? usage.state.data.providers.map(p => usageLabel(p.providerId, p.windows.find(w => w.id === p.preferredWindowId)?.usedPercent)).join(" · ") : "unavailable";
  return <>
    <Head kicker="AQ server" title={window.location.host} />
    <DetailList className={styles.facts}>
      <dt>Health</dt><dd>{`ok · v${view.server.version} · ${view.server.sourceRevision.slice(0, 8)}`}</dd>
      <dt>Ready tasks</dt><dd>{`${ready ?? "unknown"}`}{waitingShown ? ` (${view.waiting.agents.length || ready} waiting for a slot)` : ""}</dd>
      <dt>Running agents</dt><dd>{view.server.runningAgents ?? "—"}</dd>
      <dt>Owner availability</dt><dd>{availabilityText(view)}</dd>
      <dt>Usage window</dt><dd>{usageText}</dd>
      <dt>Projects</dt><dd>{projects.data?.view.length ? projects.data.view.map(p => p.label).join(", ") : "unavailable"}</dd>
    </DetailList>
    <OwnerAvailability a={view.server.ownerAvailability} />
    <div className={styles.actions}><Settings label="Open settings" /></div>
    <AddMachine />
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
    <WorkerManagement kind="machine" id={m.id} name={m.label} maximum={m.agentMax} />
    <DetailList className={styles.facts}>
      <dt>State</dt><dd>{stateText(m)}</dd>
      <dt>Load now</dt><dd>{l ? `CPU ${l.cpuPercent}% · RAM ${l.memoryPercent}%${l.fresh ? "" : ` (as of ${formatAge(serverTime, l.observedAt)})`}` : "—"}</dd>
      <dt>Load avg</dt><dd>{l ? l.cpuAvgPercent === null && l.memoryAvgPercent === null ? "—" : `CPU ${l.cpuAvgPercent === null ? "—" : `${l.cpuAvgPercent}%`} · RAM ${l.memoryAvgPercent === null ? "—" : `${l.memoryAvgPercent}%`} (last 15 min)` : "—"}</dd>
      <dt>Load source</dt><dd>{l ? (l.source === "windows_host" ? "Windows host (WSL2)" : l.source === "linux" ? (l.hostProbe === "missing" ? "WSL VM" : "Linux") : "unknown") : "unknown"}</dd>
      {l && l.hostProbe === "stale" && <><dt>Note</dt><dd>Windows host probe stale: showing WSL VM load</dd></>}
      <dt>Cores / RAM</dt><dd>{m.hardware ? `${m.hardware.logicalCpus ?? "—"} / ${gb(m.hardware.memoryTotalBytes, 2 ** 30)} GB` : "unknown"}</dd>
      <dt>Disk free</dt><dd>{m.hardware?.diskFreeBytes != null ? `${gb(m.hardware.diskFreeBytes, 1e9)} GB` : "unknown"}</dd>
      <dt>Worker nodes</dt><dd>{m.nodes.length}{offline > 0 ? ` (${offline} offline)` : ""}</dd>
      {m.kind === "cloud" && <><dt>Cost</dt><dd>{m.cost ? `$${(m.cost.microsPerHour / 1e6).toFixed(2)} / h · up ${formatAge(serverTime, m.cost.startedAt).replace(/ ago$/, "")}` : "—"}</dd></>}
      <Holding holds={m.holding} />
    </DetailList>
    <MachineControls m={m} />
  </>;
}

function selectedWorker(view: SwarmView, nodeId: string) {
  for (const machine of view.machines) {
    const node = machine.nodes.find(item => item.id === nodeId);
    if (node) return { machine, node };
  }
}
function selectedAgent(view: SwarmView, sessionId: string) {
  for (const machine of view.machines) for (const node of machine.nodes) {
    const agent = node.agents.find(item => item.sessionId === sessionId);
    if (agent) return agent;
  }
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

export function SwarmPane({ view, selection, ready, note, onCloseWorker }: { view: SwarmView; selection: Selection | null; ready: number | null; note?: string | null; onCloseWorker(): void }) {
  if (!selection) return <Empty />;
  return <>{note && <p role="note" className={styles.actionNote}>{note}</p>}<Body view={view} selection={selection} ready={ready} onCloseWorker={onCloseWorker} /></>;
}

function WaitingPane({ view, ready }: { view: SwarmView; ready: number | null }) {
    const n = view.waiting.agents.length || ready || 0;
    return <>
      <Head kicker="Waiting" title={`${n} waiting`} />
      <DetailList className={styles.facts}>
        <dt>Why</dt><dd>{view.waiting.reasons.map(r => <div key={r.code}>{r.message}</div>)}</dd>
        <dt>Fix</dt><dd>{view.waiting.reasons.filter(r => r.remedy).map(r => <div key={r.code}>{r.remedy}</div>)}</dd>
      </DetailList>
    </>;
}

function WaitingAgentPane({ view, taskId }: { view: SwarmView; taskId: string }) {
    const w = view.waiting.agents.find(x => x.taskId === taskId);
    if (!w) return <Empty />;
    return <>
      <Head kicker="Waiting agent" title={w.title} />
      <DetailList className={styles.facts}>
        <dt>Why</dt><dd>{w.reasons.map(r => r.message).join("; ")}</dd>
        <dt>Fix</dt><dd>{w.reasons.flatMap(r => (r.remedy ? [r.remedy] : [])).join("; ")}</dd>
      </DetailList>
    </>;
}

function FreePane({ machine, node }: { machine: MachineView; node: NodeView }) {
    const hold = machine.state === "holding" ? machine.holding[0] : undefined;
    return <>
      <Head kicker="Free slot" title="waiting for ready work" />
      <DetailList className={styles.facts}>
        <dt>Node</dt><dd>{node.name}</dd>
        <dt>Takes</dt><dd>any provider and class allowed on this node</dd>
        {hold && <><dt>Why</dt><dd>{`Free, but this machine is holding back: ${hold.message}`}</dd>{hold.remedy && <><dt>Fix</dt><dd>{hold.remedy}</dd></>}</>}
      </DetailList>
    </>;
}

function HeldPane({ node }: { node: NodeView }) {
    return <>
      <Head kicker="Slot held" title="Starting or settling" />
      <DetailList className={styles.facts}>
        <dt>Node</dt><dd>{node.name}</dd>
        <dt>What</dt><dd>{HELD_TEXT}</dd>
        <dt>Which</dt><dd>The server does not say which task holds this slot until its agent has started.</dd>
      </DetailList>
    </>;
}

function SelectedAgent({ agent, serverTime }: { agent: AgentView; serverTime: string }) {
    if (agent.manual) return <AgentPane agent={agent} serverTime={serverTime} />;
    return <>
      <Head kicker={`Agent · ${agent.provider ?? "agent"} · ${agentClassLabel(agent)}`} title={taskLabel(agent)} />
      <AgentPane agent={agent} serverTime={serverTime} />
    </>;
}

function Body({ view, selection, ready, onCloseWorker }: { view: SwarmView; selection: Selection; ready: number | null; onCloseWorker(): void }) {
  switch (selection.kind) {
    case "server": return <ServerPane view={view} ready={ready} />;
    case "waiting": return <WaitingPane view={view} ready={ready} />;
    case "waitingAgent": return <WaitingAgentPane view={view} taskId={selection.taskId} />;
    case "machine": {
      const machine = view.machines.find(item => item.id === selection.machineId);
      return machine ? <MachinePane key={machine.id} m={machine} serverTime={view.serverTime} /> : <Empty />;
    }
    case "agent": {
      const agent = selectedAgent(view, selection.sessionId);
      return agent ? <SelectedAgent agent={agent} serverTime={view.serverTime} /> : <Empty />;
    }
    default: return <SelectedWorker view={view} selection={selection} onCloseWorker={onCloseWorker} />;
  }
}

function SelectedWorker({ view, selection, onCloseWorker }: { view: SwarmView; selection: Extract<Selection, { nodeId: string }>; onCloseWorker(): void }) {
  const worker = selectedWorker(view, selection.nodeId);
  if (!worker) return <Empty />;
  if (selection.kind === "free") return <FreePane {...worker} />;
  if (selection.kind === "held") return <HeldPane node={worker.node} />;
  return <WorkerInspector key={worker.node.id} {...worker} serverTime={view.serverTime} onClose={onCloseWorker} />;
}

/** "anthropic 42%", or "anthropic unknown" when the percentage is not known. */
export function usageLabel(providerId: string, usedPercent: number | null | undefined): string {
  return `${providerId} ${usedPercent === null || usedPercent === undefined ? "unknown" : `${usedPercent}%`}`;
}
