import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";

/**
 * What a slot is doing.
 * - `starting`, `running`, `finishing`: an agent the read names, in the phase the server (or the interactive session) reports.
 * - `held`: an attempt holds the slot and the read names no agent for it. It is starting, or it stopped and its result is
 *   being settled; the swarm read does not say which, so the page does not guess.
 * - `stopped`: an interactive agent that stopped or failed, kept only while it is selected. It occupies nothing.
 */
export type SlotState = "starting" | "running" | "finishing" | "held" | "stopped" | "free";
export type Slot = { key: string; state: SlotState; agent: AgentView | null; /** A last free tile standing for this many free slots. */ more?: number };

export const SLOT_LABEL: Record<SlotState, string> = {
  starting: "Starting", running: "Running", finishing: "Finishing", held: "Starting or settling", stopped: "Stopped", free: "Free",
};
/** Free tiles drawn per worker before the rest are summed into one. */
export const MAX_FREE_TILES = 8;

export function agentState(a: AgentView): Exclude<SlotState, "held" | "free"> {
  if (a.manual) {
    const s = a.manual.status;
    return s === "running" ? "running" : s === "stopping" ? "finishing" : s === "stopped" || s === "failed" ? "stopped" : "starting";
  }
  return a.phase ?? "running";
}

/** Slots an attempt holds without an agent the read names. Never negative: a server may list an agent before it counts it. */
export function heldCount(n: NodeView): number {
  return Math.max(0, Math.trunc(n.slots.held ?? 0));
}

/** Machines whose workers and slots the page draws; an offline, stopped or booting machine is one card with no slots. */
export function drawsSlots(m: MachineView): boolean {
  return m.state !== "offline" && m.state !== "stopped" && m.state !== "booting";
}

/** A worker's slots in a stable order: named agents, held slots, then free ones. */
export function nodeSlots(n: NodeView, maxFree = MAX_FREE_TILES): Slot[] {
  const slots: Slot[] = n.agents.map(a => ({ key: `agent:${a.sessionId}`, state: agentState(a), agent: a }));
  for (let i = 0; i < heldCount(n); i++) slots.push({ key: `held:${n.id}:${i}`, state: "held", agent: null });
  const idle = Math.max(0, n.slots.idle ?? 0), tiles = Math.min(idle, maxFree);
  for (let i = 0; i < tiles; i++) slots.push({ key: `free:${n.id}:${i}`, state: "free", agent: null, ...(i === tiles - 1 && idle > maxFree ? { more: idle - maxFree + 1 } : {}) });
  return slots;
}

export type Counts = { running: number; starting: number; finishing: number; held: number; free: number; /** Null when a worker reports no slot total. */ total: number | null };
export type MachineCounts = Counts & { id: string; label: string; state: MachineView["state"]; live: boolean };
export type SwarmCounts = Counts & { machines: MachineCounts[]; /** Machines with at least one running agent. */ machinesRunning: number; /** Machines with any occupied slot. */ machinesBusy: number };

const ZERO: Counts = { running: 0, starting: 0, finishing: 0, held: 0, free: 0, total: 0 };
function add(a: Counts, b: Counts): Counts {
  return { running: a.running + b.running, starting: a.starting + b.starting, finishing: a.finishing + b.finishing, held: a.held + b.held, free: a.free + b.free,
    total: a.total === null || b.total === null ? null : a.total + b.total };
}
export function nodeCounts(n: NodeView): Counts {
  const c: Counts = { ...ZERO, held: heldCount(n), free: Math.max(0, n.slots.idle ?? 0), total: n.slots.total };
  for (const a of n.agents) { const s = agentState(a); if (s !== "stopped") c[s] += 1; }
  return c;
}
export const occupied = (c: Counts) => c.running + c.starting + c.finishing + c.held;

/** Counts from the same rows the page draws, so the headline and the tiles cannot disagree. */
export function swarmCounts(view: SwarmView): SwarmCounts {
  const machines = view.machines.map((m): MachineCounts => {
    const live = drawsSlots(m);
    const sum = live ? m.nodes.reduce((acc, n) => add(acc, nodeCounts(n)), ZERO) : { ...ZERO, total: null };
    return { ...sum, id: m.id, label: m.label, state: m.state, live };
  });
  const all = machines.filter(m => m.live).reduce<Counts>((acc, m) => add(acc, m), ZERO);
  return { ...all, machines, machinesRunning: machines.filter(m => m.running > 0).length, machinesBusy: machines.filter(m => occupied(m) > 0).length };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "7 agents running on 2 machines". */
export function headline(c: SwarmCounts): string {
  if (c.running === 0) return occupied(c) > 0 ? "No agents running yet" : "No agents running";
  return `${plural(c.running, "agent")} running on ${plural(c.machinesRunning, "machine")}`;
}
/** The rest of the count line: what is starting, finishing, held and free. Zero parts are left out. */
export function detailParts(c: Counts): string[] {
  const parts: string[] = [];
  if (c.starting) parts.push(`${c.starting} starting`);
  if (c.finishing) parts.push(`${c.finishing} finishing`);
  if (c.held) parts.push(`${c.held} starting or settling`);
  parts.push(c.total === null ? `${c.free} free` : `${c.free} free of ${plural(c.total, "slot")}`);
  return parts;
}

/** A running clock: `0:07`, `12:34`, `1:02:03`. Null when either time is unknown. */
export function clock(now: string | null, since: string | null): string | null {
  if (!now || !since) return null;
  const ms = Date.parse(now) - Date.parse(since);
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Output within this long reads as active. Output is not progress: repaints also advance it. */
export const ACTIVE_OUTPUT_MS = 15_000;
/** `active` when the agent's terminal produced output recently, `quiet` when it did not, null when the read carries no output time. */
export function outputActivity(now: string | null, lastOutputAt: string | null | undefined): { state: "active" | "quiet"; ageMs: number } | null {
  if (!now || !lastOutputAt) return null;
  const ageMs = Date.parse(now) - Date.parse(lastOutputAt);
  if (!Number.isFinite(ageMs)) return null;
  return { state: ageMs <= ACTIVE_OUTPUT_MS ? "active" : "quiet", ageMs: Math.max(0, ageMs) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A title the server filled with the task's own id (or left empty) is not a title. */
export function titleMissing(task: { id: string; title: string } | null): boolean {
  return !!task && (task.title.trim() === "" || task.title === task.id || UUID.test(task.title.trim()));
}
/** What to show for an agent's task: its title, or a short id when the read gave none. Never an invented name. */
export function taskLabel(a: AgentView): string {
  if (!a.task) return a.manual ? "Interactive agent" : "No task";
  return titleMissing(a.task) ? `Task ${a.task.id.slice(0, 8)}` : a.task.title;
}
/** The level as its name; the model-name class of an older server; null when neither is known. */
export function levelLabel(a: AgentView): string | null {
  if (a.manual?.spec.profile_name) return a.manual.spec.profile_name;
  return a.routingProfile?.displayName ?? a.ranWith?.level ?? (a.routingProfile === undefined ? a.intelligenceClass : null);
}
