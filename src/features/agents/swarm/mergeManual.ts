import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import type { ManualFleet, ManualAgent } from "./manualFleet";

type Report = ManualFleet["workers"][number];
type Snapshot = { fleet: ManualFleet; project: string | null; selected: string | null; now: number };

export function capacity(fleet: ManualFleet, node: string, project: string) {
  const item = fleet.projects.find(p => p.id === project);
  const worker = fleet.workers.find(w => w.node_id === node);
  if (!item || !worker?.repositories.includes(item.repository_id)) return 0;
  const slot = fleet.slots.find(s => s.node_id === node && s.project_id === project);
  return Math.min(worker.max_slots, slot?.slots ?? 1);
}

function agentView(agent: ManualAgent): AgentView {
  const { id, project_id, spec, status, created_at_ms } = agent;
  return {
    sessionId: id, attemptId: id, task: null, project: { id: project_id, label: spec.project_name },
    provider: spec.provider || null, model: spec.model || null,
    harness: spec.harness ?? (spec.provider === "openai" ? "codex" : "claude"),
    intelligenceClass: null, terminalId: status === "running" ? id : null,
    startedAt: new Date(created_at_ms).toISOString(), manual: agent,
  };
}

function visibleAgent(agent: ManualAgent, { project, selected }: Snapshot) {
  if (project && agent.project_id !== project) return false;
  return !["stopped", "failed"].includes(agent.status) || selected === `agent:${agent.id}`;
}

function nodeCapacity(node: NodeView, report: Report, { project, fleet }: Snapshot) {
  if (project) return capacity(fleet, node.id, project);
  const available = fleet.projects.reduce((sum, p) => sum + capacity(fleet, node.id, p.id), 0);
  return Math.min(report.max_slots, available);
}

function slotScope({ fleet, project }: Snapshot) {
  if (!project) return "All projects";
  return fleet.projects.find(p => p.id === project)?.name ?? "Selected project";
}

function mergedSlots(node: NodeView, report: Report, snapshot: Snapshot, agents: { visible: ManualAgent[]; all: ManualAgent[] }) {
  const running = agents.visible.filter(agent => !["pending", "stopped", "failed"].includes(agent.status)).length;
  const allRunning = agents.all.filter(agent => ["preparing", "running", "stopping"].includes(agent.status)).length;
  const elsewhere = Math.max(0, allRunning - running);
  const total = nodeCapacity(node, report, snapshot);
  // Attempts that hold slots before an agent starts, or after it stops, still occupy them.
  const held = node.slots.held ?? Math.max(0, node.slots.occupied - node.agents.length);
  const occupied = node.agents.length + held + running;
  const idle = Math.min(Math.max(0, total - occupied), Math.max(0, report.max_slots - occupied - elsewhere));
  return { total: Math.max(total, occupied), occupied, idle, held, scope: slotScope(snapshot), ...(total < occupied ? { target: total } : {}) };
}

function freshReport(report: Report, now: number) {
  return now - report.observed_at_ms < 15000;
}

function mergeNode(node: NodeView, snapshot: Snapshot): NodeView {
  const report = snapshot.fleet.workers.find(w => w.node_id === node.id);
  if (!report || node.health === "revoked") return node;
  const all = snapshot.fleet.sessions.filter(agent => agent.node_id === node.id);
  const visible = all.filter(agent => visibleAgent(agent, snapshot));
  return {
    ...node, ...(freshReport(report, snapshot.now) ? { health: "online" as const, lastSeenAt: new Date(report.observed_at_ms).toISOString() } : {}),
    backendKind: node.backendKind ?? "docker-local",
    slots: mergedSlots(node, report, snapshot, { all, visible }),
    agents: [...node.agents, ...visible.map(agentView)],
  };
}

function machineState(machine: MachineView, snapshot: Snapshot) {
  if (!["offline", "unknown"].includes(machine.state) || machine.control?.desired === "stopped") return machine.state;
  const available = machine.nodes.some(node => node.health !== "revoked" && snapshot.fleet.workers.some(
    report => report.node_id === node.id && freshReport(report, snapshot.now)));
  return available ? "online" : machine.state;
}

export function mergeManual(view: SwarmView, fleet: ManualFleet | undefined, project: string | null, selected: string | null): SwarmView {
  if (!fleet) return view;
  const snapshot = { fleet, project, selected, now: Math.max(fleet.server_time_ms, Date.parse(view.serverTime) || 0) };
  return { ...view, machines: view.machines.map(machine => ({
    ...machine, state: machineState(machine, snapshot), nodes: machine.nodes.map(node => mergeNode(node, snapshot)),
  })) };
}
