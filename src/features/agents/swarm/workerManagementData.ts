import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../../api/client";
import { isRecord, ContractError, nullable, positiveInteger } from "../../../api/adapters/contract";
import type { MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { queryKey } from "../../../api/queryKeys";
import { useSession, PANEL_READ } from "../../../app/session";

export type Setting = {
  kind: "machine" | "node";
  id: string;
  label: string | null;
  max_agents: number | null;
  removed: boolean;
  revision: number;
};
type Settings = { settings: Setting[] };

const isLabel = (value: unknown): value is string => typeof value === "string";
function validLimit(value: unknown) {
  if (!Number.isInteger(value)) return false;
  return Number(value) >= 0 && Number(value) <= 2_147_483_647;
}

export function isSetting(raw: unknown): raw is Setting {
  if (!isRecord(raw)) return false;
  const identity = ["machine", "node"].includes(String(raw.kind)) && isLabel(raw.id);
  const data = nullable(raw.label, isLabel) && nullable(raw.max_agents, validLimit);
  return identity && data && typeof raw.removed === "boolean" && positiveInteger(raw.revision);
}

async function readSettings(signal: AbortSignal): Promise<Settings> {
  const raw = await apiGet<unknown>("/api/worker-management", signal);
  if (isRecord(raw) && Array.isArray(raw.settings)) {
    if (raw.settings.every(isSetting)) return { settings: raw.settings };
  }
  throw new ContractError("Invalid worker settings");
}

export function useWorkerSettings() {
  const { bootstrap, queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "worker-settings", {}), queryFn: ({ signal }) => readSettings(signal),
    enabled: bootstrap.capability("swarm.worker.control").enabled, refetchInterval: 10_000, retry: false, meta: PANEL_READ,
  });
}

function settingsFor(rows: Setting[], kind: Setting["kind"], id: string) {
  return rows.find(row => row.kind === kind && row.id === id);
}

function applyNodeSettings(node: NodeView, rows: Setting[]) {
  const own = rows.filter(row => row.kind === "node" && row.id === node.id);
  if (own.some(row => row.removed)) return [];
  return [{ ...node, name: own[0]?.label ?? node.name }];
}

function applyMachineSettings(machine: MachineView, rows: Setting[]) {
  const own = settingsFor(rows, "machine", machine.id);
  const nodes = machine.nodes.flatMap(node => applyNodeSettings(node, rows));
  const total = nodes.every(n => n.slots.total !== null) ? nodes.reduce((sum, n) => sum + n.slots.total!, 0) : machine.agentMax;
  return { ...machine, label: own?.label ?? machine.label, agentMax: own?.max_agents ?? total, nodes };
}

export function applyWorkerSettings(view: SwarmView, settings: Settings | undefined): SwarmView {
  if (!settings) return view;
  return { ...view, machines: view.machines.map(machine => applyMachineSettings(machine, settings.settings)) };
}
