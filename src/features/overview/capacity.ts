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

export function machineCapacity(machine: MachineView, paused: boolean): MachineCapacity | null {
  const online = machine.nodes.filter(node => node.health === "online");
  if (online.length === 0 || machine.state === "offline" || machine.state === "booting") return null;

  const slots = { open: 0, inUse: 0, held: 0, incomplete: false };
  const holds = new Set<string>();
  const stopped = machine.control?.desired === "stopped" || machine.state === "stopped";
  const draining = machine.control?.desired === "draining";
  if (paused) holds.add("Owner availability is off");
  if (stopped) holds.add("Machine is stopped");
  if (draining) holds.add("Machine is draining");

  for (const node of online) {
    const { total, idle, occupied } = node.slots;
    slots.inUse += occupied;
    if (total === null || idle === null) {
      slots.incomplete = true;
      continue;
    }
    const remaining = Math.max(0, total - occupied);
    const open = Math.min(remaining, idle);
    const blocked = paused || stopped || draining || node.service === "stopped" ||
      node.service === "draining" || node.holding.length > 0;
    if (blocked && remaining > 0) {
      if (node.service === "stopped") holds.add("Worker is stopped");
      if (node.service === "draining") holds.add("Worker is draining");
      for (const hold of node.holding) if (hold.message) holds.add(hold.message);
    }
    slots.open += blocked ? 0 : open;
    slots.held += remaining - (blocked ? 0 : open);
  }

  // A machine maximum is shared by its workers, including charges for any
  // still-held slots on a disconnected worker.
  if (machine.agentMax !== null) {
    const occupied = machine.nodes.reduce((sum, node) => sum + (node.health === "revoked" ? 0 : node.slots.occupied), 0);
    const open = Math.min(slots.open, Math.max(0, machine.agentMax - occupied));
    if (open < slots.open) holds.add("Machine agent limit");
    slots.held += slots.open - open;
    slots.open = open;
  }

  const headroom: MachineCapacity["headroom"] = {};
  const { load, hardware } = machine;
  if (load?.fresh) {
    headroom.CPU = { percent: 100 - load.cpuPercent };
    const memory = 100 - load.memoryPercent;
    headroom.Memory = { percent: memory };
    if (hardware && hardware.memoryTotalBytes > 0) {
      headroom.Memory.freeBytes = Math.round(hardware.memoryTotalBytes * memory / 100);
    }
    const total = hardware?.diskTotalBytes;
    const free = hardware?.diskFreeBytes;
    if (total != null && free != null && total > 0 && free >= 0 && free <= total) {
      headroom.Disk = { percent: (free / total) * 100, freeBytes: free };
    }
  }

  return {
    id: machine.id, name: machine.label, slots, holds: [...holds], headroom,
    loadLabel: load?.fresh && load.source === "linux" && (load.hostProbe === "stale" || load.hostProbe === "missing") ? "WSL VM readings" : undefined,
  };
}

export function fleetSlots(machines: MachineCapacity[], incomplete: boolean): SlotCounts {
  return machines.reduce<SlotCounts>((fleet, { slots }) => ({
    open: fleet.open + slots.open,
    inUse: fleet.inUse + slots.inUse,
    held: fleet.held + slots.held,
    incomplete: fleet.incomplete || slots.incomplete,
  }), { open: 0, inUse: 0, held: 0, incomplete });
}

export function tightestHeadroom(machines: MachineCapacity[], resource: Resource) {
  let lowest: { machine: string; reading: Headroom } | undefined;
  for (const machine of machines) {
    const reading = machine.headroom[resource];
    if (reading && (!lowest || reading.percent < lowest.reading.percent)) {
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
