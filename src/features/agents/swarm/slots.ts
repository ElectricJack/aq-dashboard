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

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

/** Project, role and level; then model and effort. Only what the read (or the task's own read) gave. */
export function agentLines(a: AgentView): { who: string; what: string } {
  const level = levelLabel(a);
  const model = a.ranWith?.model ?? a.model;
  const effort = a.ranWith?.reasoning ?? a.manual?.spec.reasoning;
  return {
    who: [a.project.label, a.ranWith?.role, level].filter(Boolean).join(" · "),
    what: [model ?? a.harness ?? a.provider, effort ? `${effort} effort` : null].filter(Boolean).join(" · "),
  };
}

export type Level = "simple" | "standard" | "complex" | "deep";
const LEVELS: readonly Level[] = ["simple", "standard", "complex", "deep"];
/**
 * The level an agent runs at, for its colour: the first word of the level's id or name ("standard-high", "Complex"),
 * else an older server's class (its "fast" is the simple level). Null when the read names neither.
 */
export function levelKey(a: Pick<AgentView, "routingProfile" | "ranWith" | "intelligenceClass" | "manual">): Level | null {
  for (const name of [a.routingProfile?.id, a.ranWith?.level, a.routingProfile?.displayName, a.manual?.spec.profile_name]) {
    const word = name?.trim().toLowerCase().split(/[^a-z]+/)[0];
    const hit = LEVELS.find(l => l === word);
    if (hit) return hit;
  }
  return a.intelligenceClass === "fast" ? "simple" : a.intelligenceClass;
}

/**
 * How many slots a node really has. A node runs one queued task at a time, and `slots.total` is today the cap on
 * interactive sessions, so the count is one unless the server marked its total as the real count (`NodeView.capacity`).
 */
export function slotCapacity(n: NodeView): number {
  return n.capacity ?? 1;
}
/** A node that is there to hold attempts: not offline, revoked, stopped or booting. */
function nodeLive(m: MachineView, n: NodeView): boolean {
  const s = standing(m, n).standing;
  return s !== "offline" && s !== "revoked" && s !== "stopped" && s !== "booting";
}
/** Why a node takes no work now, when it does not simply have a free slot. */
export function nodeStanding(m: MachineView, n: NodeView): Pick<WorkerTile, "standing" | "reason"> {
  return standing(m, n);
}
/** The attempts that fill a node's real slots, at most one per slot: its agents (the queued, running one first), then attempts the read does not name. */
function slotHolders(m: MachineView, n: NodeView): { agents: AgentView[]; held: number } {
  if (!nodeLive(m, n)) return { agents: [], held: 0 };
  const capacity = slotCapacity(n);
  const agents = n.agents.filter(a => agentState(a) !== "stopped").sort(shownFirst).slice(0, capacity);
  return { agents, held: Math.min(heldCount(n), capacity - agents.length) };
}

/** One card under a node in the tree: an attempt the read lists, an attempt it does not name, or a slot nothing holds. */
export type NodeSlot =
  | { kind: "agent"; agent: AgentView; slot: number | null }
  | { kind: "held"; index: number; slot: number | null }
  | { kind: "free"; index: number; slot: number | null; standing: WorkerTile["standing"] };
/**
 * The cards the tree draws under a node: every attempt the read lists, every attempt it does not name, and free cards
 * up to the node's real slot count, so a node always has at least as many cards as slots. When the server numbers the
 * slots the cards are in slot order; otherwise attempts come first, in the order read.
 */
export function nodeSlots(m: MachineView, n: NodeView): NodeSlot[] {
  const capacity = slotCapacity(n), held = heldCount(n), why = standing(m, n).standing;
  const numbered = n.capacity !== undefined && n.agents.some(a => a.slot !== undefined);
  const cards: NodeSlot[] = [];
  const free = (index: number, slot: number | null): NodeSlot => ({ kind: "free", index, slot, standing: why });
  if (numbered) {
    const bySlot = new Map<number, AgentView>(), extra: AgentView[] = [];
    for (const a of n.agents) (a.slot !== undefined && a.slot <= capacity && !bySlot.has(a.slot) ? bySlot.set(a.slot, a) : extra.push(a));
    let heldLeft = held, heldIndex = 0, freeIndex = 0;
    for (let slot = 1; slot <= capacity; slot++) {
      const a = bySlot.get(slot);
      if (a) cards.push({ kind: "agent", agent: a, slot });
      else if (heldLeft > 0) { heldLeft -= 1; cards.push({ kind: "held", index: heldIndex++, slot }); }
      else cards.push(free(freeIndex++, slot));
    }
    for (const a of extra) cards.push({ kind: "agent", agent: a, slot: null });
    for (; heldLeft > 0; heldLeft--) cards.push({ kind: "held", index: heldIndex++, slot: null });
    return cards;
  }
  for (const a of n.agents) cards.push({ kind: "agent", agent: a, slot: null });
  for (let i = 0; i < held; i++) cards.push({ kind: "held", index: i, slot: null });
  for (let i = 0; cards.length < capacity; i++) cards.push(free(i, n.capacity === undefined ? null : cards.length + 1));
  return cards;
}

/** The nodes of a machine that hold in the current response: only a node's own `holding` list says so. */
export function holdingNodes(m: MachineView): NodeView[] {
  return drawsSlots(m) ? m.nodes.filter(n => n.holding.length > 0) : [];
}
/** The machine's state as the page shows it: "holding" only while one of its nodes holds in this response. */
export function shownMachineState(m: MachineView): MachineView["state"] {
  return m.state === "holding" && holdingNodes(m).length === 0 ? "online" : m.state;
}

export type WorkerCounts = {
  /** Real slots, and how many an attempt holds. */
  workers: number; busy: number; starting: number; running: number; finishing: number; held: number;
  /** Machines (each machine's worker service) with at least one busy slot. */
  machinesBusy: number;
  machines: { id: string; label: string; state: MachineView["state"]; live: boolean; workers: number; busy: number }[];
  /** What runs right now by model, most first; `cls` is the level class of its agents when they all share one. */
  models: { model: string; count: number; cls: AgentView["intelligenceClass"] }[];
};
/** One machine's real slots and how many are busy. */
export function machineSlots(m: MachineView): { slots: number; busy: number } {
  let slots = 0, busy = 0;
  for (const n of m.nodes) { const h = slotHolders(m, n); slots += slotCapacity(n); busy += h.agents.length + h.held; }
  return { slots, busy };
}
/**
 * The one count behind the line above the tree and above the board: real slots, how many are busy, on how many
 * machines, in which phase, and what runs by model. A node counts one slot unless the server reports its real count.
 */
export function workerCounts(view: SwarmView): WorkerCounts {
  const c: WorkerCounts = { workers: 0, busy: 0, starting: 0, running: 0, finishing: 0, held: 0, machinesBusy: 0, machines: [], models: [] };
  const models = new Map<string, WorkerCounts["models"][number]>();
  for (const m of view.machines) {
    for (const n of m.nodes) {
      const h = slotHolders(m, n);
      if (h.agents.length + h.held === 0) continue;
      c.held += h.held;
      for (const a of h.agents) c[agentState(a) as "starting" | "running" | "finishing"] += 1;
      for (const a of n.agents) {
        if (agentState(a) === "stopped") continue;
        const model = modelLabel(a), seen = models.get(model);
        if (seen) { seen.count += 1; if (seen.cls !== a.intelligenceClass) seen.cls = null; }
        else models.set(model, { model, count: 1, cls: a.intelligenceClass });
      }
    }
    const { slots, busy } = machineSlots(m);
    c.workers += slots; c.busy += busy; if (busy > 0) c.machinesBusy += 1;
    c.machines.push({ id: m.id, label: m.label, state: shownMachineState(m), live: drawsSlots(m), workers: slots, busy });
  }
  c.models = [...models.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  return c;
}
/** A machine's share of the count line: "Fixture desktop: 6 of 8 slots busy". */
export function machineShare(m: WorkerCounts["machines"][number]): string {
  if (!m.live) return `${m.label}: ${m.state}`;
  return `${m.label}: ${m.busy} of ${plural(m.workers, "slot")} busy${m.state === "holding" ? " · holding" : ""}`;
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
