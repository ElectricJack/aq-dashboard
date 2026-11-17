import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";

/**
 * What a slot is doing.
 * - `starting`, `running`, `finishing`: an agent the read names, in the phase the server (or the interactive session) reports.
 * - `held`: an attempt holds the slot and the read names no agent for it. It is starting, or it stopped and its result is
 *   being settled; the swarm read does not say which, so the page does not guess.
 * - `stopped`: an interactive agent that stopped or failed, kept only while it is selected. It occupies nothing.
 */
export type SlotState = "starting" | "running" | "finishing" | "held" | "stopped" | "free";

export const SLOT_LABEL: Record<SlotState, string> = {
  starting: "Starting", running: "Running", finishing: "Finishing", held: "Starting or settling", stopped: "Stopped", free: "Free",
};
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

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

/*
 * The board: one tile per worker. A worker runs one queued task at a time; `slots` counts interactive-session slots,
 * which is a different thing, so the board does not draw them.
 */
export type WorkerState = "busy" | "idle" | "holding" | "draining" | "stopped" | "offline" | "booting" | "revoked" | "unknown";
export type WorkerTile = {
  node: NodeView; state: WorkerState;
  /** A busy worker's phase: its agent's, or `held` when an attempt holds it and the read names no agent. */
  phase: Exclude<SlotState, "stopped" | "free"> | null;
  /** The attempt the tile shows: the queued one before an interactive one, a running one before the rest, then the latest start. */
  agent: AgentView | null;
  /** Everything else the worker holds, so nothing is dropped: other agents, and attempts the read does not name. */
  others: AgentView[]; heldMore: number;
  /** Why the worker is not simply idle (drawn in the tile), or what a busy worker is also doing (drawn beside its name). */
  standing: Exclude<WorkerState, "busy" | "idle"> | null; reason: string | null;
};

function standing(m: MachineView, n: NodeView): Pick<WorkerTile, "standing" | "reason"> {
  const is = (s: WorkerTile["standing"], reason: string | null = null) => ({ standing: s, reason });
  if (m.state === "offline" || n.health === "offline") return is("offline");
  if (n.health === "revoked") return is("revoked");
  if (m.state === "stopped" || n.service === "stopped") return is("stopped");
  if (m.state === "booting") return is("booting");
  if (n.service === "draining" || m.control?.desired === "draining") return is("draining");
  if (n.holding[0]) return is("holding", n.holding[0].message);
  if (n.health === "unknown") return is("unknown");
  return is(null);
}
const START = (a: AgentView) => (a.startedAt ? Date.parse(a.startedAt) || 0 : 0);
function shownFirst(a: AgentView, b: AgentView): number {
  return Number(!!a.manual) - Number(!!b.manual) || Number(agentState(a) !== "running") - Number(agentState(b) !== "running") || START(b) - START(a);
}

export function workerTile(m: MachineView, n: NodeView): WorkerTile {
  const why = standing(m, n);
  // A worker that is not there holds nothing now; what the read still lists for it is kept as "+N".
  const live = why.standing !== "offline" && why.standing !== "revoked" && why.standing !== "stopped" && why.standing !== "booting";
  const agent = live ? n.agents.filter(a => agentState(a) !== "stopped").sort(shownFirst)[0] ?? null : null;
  const held = heldCount(n), busy = live && (!!agent || held > 0);
  const phase = !busy ? null : agent ? agentState(agent) as WorkerTile["phase"] : "held";
  return { node: n, state: busy ? "busy" : why.standing ?? "idle", phase, agent, others: n.agents.filter(a => a !== agent), heldMore: busy && !agent ? held - 1 : held, ...why };
}

/** The model an agent runs on, as the read names it. */
export function modelLabel(a: AgentView): string {
  return a.ranWith?.model ?? a.model ?? a.harness ?? a.provider ?? "model not reported";
}

export type WorkerCounts = {
  workers: number; busy: number; starting: number; running: number; finishing: number; held: number;
  /** Machines with at least one busy worker. */
  machinesBusy: number;
  machines: { id: string; label: string; state: MachineView["state"]; live: boolean; workers: number; busy: number }[];
  /** What runs right now by model, most first; `cls` is the level class of its agents when they all share one. */
  models: { model: string; count: number; cls: AgentView["intelligenceClass"] }[];
};
/** Counts from the tiles the board draws, so the headline and the tiles cannot disagree. */
export function workerCounts(view: SwarmView): WorkerCounts {
  const c: WorkerCounts = { workers: 0, busy: 0, starting: 0, running: 0, finishing: 0, held: 0, machinesBusy: 0, machines: [], models: [] };
  const models = new Map<string, WorkerCounts["models"][number]>();
  for (const m of view.machines) {
    let busy = 0;
    for (const n of m.nodes) {
      const t = workerTile(m, n);
      if (t.state !== "busy") continue;
      busy += 1; c[t.phase!] += 1;
      for (const a of n.agents) {
        if (agentState(a) === "stopped") continue;
        const model = modelLabel(a), seen = models.get(model);
        if (seen) { seen.count += 1; if (seen.cls !== a.intelligenceClass) seen.cls = null; }
        else models.set(model, { model, count: 1, cls: a.intelligenceClass });
      }
    }
    c.workers += m.nodes.length; c.busy += busy; if (busy > 0) c.machinesBusy += 1;
    c.machines.push({ id: m.id, label: m.label, state: m.state, live: drawsSlots(m), workers: m.nodes.length, busy });
  }
  c.models = [...models.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  return c;
}
/** "7 of 9 slots busy on 2 workers": the board calls each tile a slot and each machine's service a worker. */
export function workerHeadline(c: WorkerCounts): string {
  if (c.workers === 0) return "No slots";
  return `${c.busy} of ${plural(c.workers, "slot")} busy${c.busy > 0 ? ` on ${plural(c.machinesBusy, "worker")}` : ""}`;
}
/** The busy workers by phase. Zero parts are left out. */
export function phaseParts(c: WorkerCounts): string[] {
  return [c.starting && `${c.starting} starting`, c.running && `${c.running} running`, c.finishing && `${c.finishing} finishing`, c.held && `${c.held} starting or settling`].filter((p): p is string => !!p);
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
