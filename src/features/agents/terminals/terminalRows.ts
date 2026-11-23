import type { AgentView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import type { ManualAgent, ManualFleet } from "../swarm/manualFleet";

export type Row = {
  key: string; id: string; project: string; projectId: string; worker: string;
  model: string; status: string; terminal: string | null; manual: boolean;
};

const validKey = (key: unknown) => typeof key === "string" && /^(manual|native):.{1,256}$/.test(key);
export function validIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 4 && value.every(validKey) && new Set(value).size === value.length;
}

function nativeRow(agent: AgentView, worker: NodeView): Row {
  return {
    key: `native:${agent.sessionId}`, id: agent.sessionId, project: agent.task?.title ?? agent.project.label, projectId: agent.project.id,
    worker: worker.name, model: [agent.provider, agent.model].filter(Boolean).join(" · "), status: "Listed in Swarm", terminal: agent.terminalId, manual: false,
  };
}
function manualRow(agent: ManualAgent, names: Record<string, string>): Row {
  return {
    key: `manual:${agent.id}`, id: agent.id, project: agent.spec.project_name, projectId: agent.project_id,
    worker: names[agent.node_id] ?? "Worker unavailable", model: [agent.spec.provider, agent.spec.model].filter(Boolean).join(" · "),
    status: agent.status, terminal: agent.id, manual: true,
  };
}
export function rosterRows(view: SwarmView | undefined, fleet: ManualFleet | undefined, project: string | null) {
  const machines = view?.machines ?? [];
  const workerNames: Record<string, string> = Object.fromEntries(machines.flatMap(m => m.nodes.map(n => [n.id, n.name || m.label])));
  const inScope = (agent: AgentView) => !project || agent.project.id === project;
  const native = machines.flatMap(m => m.nodes.flatMap(n => n.agents.filter(inScope).map(a => nativeRow(a, n))));
  const manual = fleet?.sessions.map(agent => manualRow(agent, workerNames)) ?? [];
  return { rows: [...manual, ...native], workerNames };
}
export function savedRow(key: string, known: Record<string, Row>, refused: boolean): Row {
  const manual = key.startsWith("manual:");
  const hidden = refused && manual;
  if (!hidden && known[key]) return known[key];
  return {
    key, id: key.slice(key.indexOf(":") + 1), project: hidden ? "Unavailable agent" : "Saved agent", projectId: "",
    worker: "", model: "", status: "Loading", terminal: null, manual,
  };
}
export function visibleRows(rows: Row[], active: Row[]) {
  const live = rows.filter(row => !["stopped", "failed"].includes(row.status));
  const keys = new Set(live.map(row => row.key));
  return [...live, ...active.filter(row => !keys.has(row.key))];
}
