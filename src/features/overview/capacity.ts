import type { MachineView } from "../../api/adapters/swarm";

export const RESOURCES = ["CPU", "Memory", "Disk", "GPU"] as const;
type Resource = typeof RESOURCES[number];
type Headroom = { percent: number; freeBytes?: number };

type SlotCounts = { open: number; inUse: number; held: number; incomplete: boolean };
export type MachineCapacity = {
  id: string;
  name: string;
  slots: SlotCounts;
  holds: string[];
  headroom: Partial<Record<Resource, Headroom>>;
  loadLabel?: string;
};

function emptySlots(incomplete = false): SlotCounts {
  return { open: 0, inUse: 0, held: 0, incomplete };
}

export function machineCapacity(machine: MachineView, paused: boolean): MachineCapacity | null {
  const online = machine.nodes.filter(node => node.health === "online");
  if (!online.length || ["offline", "booting"].includes(machine.state)) return null;

  const holds = machineHolds(machine, paused);
  const slots = emptySlots();
  const machineBlocked = holds.size > 0;
  for (const node of online) {
    countSlots(node, { slots, holds, machineBlocked });
  }
  applyMachineLimit(machine, slots, holds);
  return {
    id: machine.id, name: machine.label, slots, holds: [...holds],
    headroom: resourceHeadroom(machine), loadLabel: loadLabel(machine.load),
  };
}

function machineHolds(machine: MachineView, paused: boolean) {
  const holds = new Set<string>();
  const desired = machine.control?.desired;
  if (paused) holds.add("Owner availability is off");
  if (desired === "stopped" || machine.state === "stopped") holds.add("Machine is stopped");
  if (desired === "draining") holds.add("Machine is draining");
  return holds;
}

type Node = MachineView["nodes"][number];
const SERVICE_HOLDS: Partial<Record<Node["service"], string>> = {
  stopped: "Worker is stopped", draining: "Worker is draining",
};
function workerHolds(node: Node) {
  const reasons = node.holding.map(hold => hold.message).filter(Boolean);
  const service = SERVICE_HOLDS[node.service];
  if (service) reasons.unshift(service);
  return reasons;
}

function countSlots(node: Node, capacity: { slots: SlotCounts; holds: Set<string>; machineBlocked: boolean }) {
  const { slots, holds, machineBlocked } = capacity;
  const { total, idle, occupied } = node.slots;
  slots.inUse += occupied;
  if (total === null || idle === null) {
    slots.incomplete = true;
    return;
  }
  const remaining = Math.max(0, total - occupied);
  const blocked = machineBlocked || Boolean(SERVICE_HOLDS[node.service]) || node.holding.length > 0;
  if (blocked && remaining > 0) workerHolds(node).forEach(reason => holds.add(reason));
  const open = blocked ? 0 : Math.min(remaining, idle);
  slots.open += open;
  slots.held += remaining - open;
}

function applyMachineLimit(machine: MachineView, slots: SlotCounts, holds: Set<string>) {
  // A machine maximum is shared by its workers, including charges for any
  // still-held slots on a disconnected worker.
  if (machine.agentMax === null) return;
  const occupied = machine.nodes.filter(node => node.health !== "revoked").reduce((sum, node) => sum + node.slots.occupied, 0);
  const open = Math.min(slots.open, Math.max(0, machine.agentMax - occupied));
  if (open < slots.open) holds.add("Machine agent limit");
  slots.held += slots.open - open;
  slots.open = open;
}

function diskHeadroom(hardware: MachineView["hardware"]): Headroom | undefined {
  const total = hardware?.diskTotalBytes;
  const free = hardware?.diskFreeBytes;
  if (total == null || free == null) return undefined;
  if (total > 0 && free >= 0 && free <= total) return { percent: (free / total) * 100, freeBytes: free };
}

function memoryHeadroom(usedPercent: number, hardware: MachineView["hardware"]): Headroom {
  const memory = 100 - usedPercent;
  const memoryReading: Headroom = { percent: memory };
  if (hardware && hardware.memoryTotalBytes > 0) {
    memoryReading.freeBytes = Math.round(hardware.memoryTotalBytes * memory / 100);
  }
  return memoryReading;
}

function resourceHeadroom({ load, hardware }: MachineView): MachineCapacity["headroom"] {
  if (!load?.fresh) return {};
  const headroom: MachineCapacity["headroom"] = { CPU: { percent: 100 - load.cpuPercent }, Memory: memoryHeadroom(load.memoryPercent, hardware) };
  const disk = diskHeadroom(hardware);
  if (disk) headroom.Disk = disk;
  return headroom;
}

function loadLabel(load: MachineView["load"]) {
  if (!load?.fresh || load.source !== "linux") return undefined;
  return ["stale", "missing"].includes(load.hostProbe) ? "WSL VM readings" : undefined;
}

export function fleetSlots(machines: MachineCapacity[], incomplete: boolean): SlotCounts {
  return machines.reduce<SlotCounts>((fleet, { slots }) => ({
    open: fleet.open + slots.open,
    inUse: fleet.inUse + slots.inUse,
    held: fleet.held + slots.held,
    incomplete: fleet.incomplete || slots.incomplete,
  }), emptySlots(incomplete));
}

export function tightestHeadroom(machines: MachineCapacity[], resource: Resource) {
  let lowest: { machine: string; reading: Headroom } | undefined;
  for (const machine of machines) {
    const reading = machine.headroom[resource];
    if (!reading) continue;
    if (!lowest || reading.percent < lowest.reading.percent) {
      lowest = { machine: machine.name, reading };
    }
  }
  return lowest;
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++; }
  return unit === 0 ? `${value} B` : `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

export function formatFreePercent(percent: number): string {
  return percent > 0 && percent < 1 ? "<1% free" : `${Math.floor(percent)}% free`;
}
