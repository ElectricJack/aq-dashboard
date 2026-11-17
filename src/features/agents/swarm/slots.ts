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

/** Why a node takes no work now, when it does not simply have free slots. */
export type Standing = "holding" | "draining" | "stopped" | "offline" | "booting" | "revoked" | "unknown";
export type NodeStanding = { standing: Standing | null; reason: string | null };

function standing(m: MachineView, n: NodeView): NodeStanding {
  const is = (s: Standing | null, reason: string | null = null) => ({ standing: s, reason });
  if (m.state === "offline" || n.health === "offline") return is("offline");
  if (n.health === "revoked") return is("revoked");
  if (m.state === "stopped" || n.service === "stopped") return is("stopped");
  if (m.state === "booting") return is("booting");
  if (n.service === "draining" || m.control?.desired === "draining") return is("draining");
  if (n.holding[0]) return is("holding", n.holding[0].message);
  if (n.health === "unknown") return is("unknown");
  return is(null);
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
 * How many slots a worker node has: the one count the server reports for it (`slots.total`), shared by queued tasks and
 * hand-started sessions. An old worker that reports none has one slot.
 */
export function slotCapacity(n: NodeView): number {
  return n.capacity ?? 1;
}
/** A node that is there to hold attempts: not offline, revoked, stopped or booting. */
function nodeLive(m: MachineView, n: NodeView): boolean {
  const s = standing(m, n).standing;
  return s !== "offline" && s !== "revoked" && s !== "stopped" && s !== "booting";
}
export function nodeStanding(m: MachineView, n: NodeView): NodeStanding {
  return standing(m, n);
}
/** The agents of a node that hold a slot: every row but an interactive agent that has stopped. */
const holders = (n: NodeView) => n.agents.filter(a => agentState(a) !== "stopped");
/**
 * How many attempts a node holds now: its agents and the attempts the read does not name. It is not capped at the
 * node's slots: more attempts than slots is shown as it is, and flagged. A node that is not there holds nothing.
 */
export function nodeBusy(m: MachineView, n: NodeView): number {
  return nodeLive(m, n) ? holders(n).length + heldCount(n) : 0;
}
/** How many attempts a node holds beyond its slots; zero is the rule. */
export function overSlots(m: MachineView, n: NodeView): number {
  return Math.max(0, nodeBusy(m, n) - slotCapacity(n));
}
/** "3 of 8 slots busy". */
export const busyOf = (busy: number, slots: number) => `${busy} of ${plural(slots, "slot")} busy`;
/** How many slot cards sit side by side under a worker: one or two for up to four slots, four for up to sixteen; beyond that the two-column stack of the layout spec. */
export function slotColumns(cards: number): number {
  return cards <= 1 ? Math.max(0, cards) : cards <= 4 ? 2 : cards <= 16 ? 4 : 2;
}

/**
 * One card under a worker node: an attempt the read lists, an attempt it does not name, or a slot nothing holds.
 * `slot` is the card's slot on its node, from one; null for a row that has no slot (more rows than slots, or an
 * interactive agent that stopped and holds nothing).
 */
export type NodeSlot =
  | { kind: "agent"; agent: AgentView; slot: number | null }
  | { kind: "held"; index: number; slot: number | null }
  | { kind: "free"; index: number; slot: number; standing: Standing | null };
/**
 * The cards under a worker node, in slot order: exactly as many slot cards as the node has slots, then any row that
 * has no slot. Slot k shows the agent whose row says `slot: k`; rows that name no slot (or one that is taken or out of
 * range) fill the lowest free positions, then attempts the read does not name; what is left is free.
 */
export function nodeSlots(m: MachineView, n: NodeView): NodeSlot[] {
  const capacity = slotCapacity(n), why = standing(m, n).standing;
  const cells = new Array<AgentView | undefined>(capacity), unplaced: AgentView[] = [], extra: AgentView[] = [];
  for (const a of holders(n)) {
    if (a.slot !== undefined && a.slot <= capacity && !cells[a.slot - 1]) cells[a.slot - 1] = a;
    else unplaced.push(a);
  }
  let next = 0;
  for (const a of unplaced) {
    while (next < capacity && cells[next]) next += 1;
    if (next < capacity) cells[next] = a; else extra.push(a);
  }
  const cards: NodeSlot[] = [];
  let heldLeft = heldCount(n), heldIndex = 0, freeIndex = 0;
  for (let slot = 1; slot <= capacity; slot++) {
    const a = cells[slot - 1];
    if (a) cards.push({ kind: "agent", agent: a, slot });
    else if (heldLeft > 0) { heldLeft -= 1; cards.push({ kind: "held", index: heldIndex++, slot }); }
    else cards.push({ kind: "free", index: freeIndex++, slot, standing: why });
  }
  for (const a of extra) cards.push({ kind: "agent", agent: a, slot: null });
  for (; heldLeft > 0; heldLeft--) cards.push({ kind: "held", index: heldIndex++, slot: null });
  for (const a of n.agents) if (agentState(a) === "stopped") cards.push({ kind: "agent", agent: a, slot: null });
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
  /** Slots on every worker node, and how many an attempt holds. */
  slots: number; busy: number; starting: number; running: number; finishing: number; held: number;
  /** Worker nodes, and how many have at least one busy slot. */
  workers: number; workersBusy: number;
  machines: { id: string; label: string; state: MachineView["state"]; live: boolean; slots: number; busy: number; workers: number; workersBusy: number }[];
  /** What runs right now by model, most first; `cls` is the level class of its agents when they all share one. */
  models: { model: string; count: number; cls: AgentView["intelligenceClass"] }[];
};
/** One machine's slots, how many are busy, and on how many of its worker nodes. */
export function machineSlots(m: MachineView): { slots: number; busy: number; workers: number; workersBusy: number } {
  let slots = 0, busy = 0, workersBusy = 0;
  for (const n of m.nodes) { const b = nodeBusy(m, n); slots += slotCapacity(n); busy += b; if (b > 0) workersBusy += 1; }
  return { slots, busy, workers: m.nodes.length, workersBusy };
}
/**
 * The one count behind the line above the tree and above the board: slots, how many are busy, on how many worker
 * nodes, in which phase, and what runs by model.
 */
export function workerCounts(view: SwarmView): WorkerCounts {
  const c: WorkerCounts = { slots: 0, busy: 0, starting: 0, running: 0, finishing: 0, held: 0, workers: 0, workersBusy: 0, machines: [], models: [] };
  const models = new Map<string, WorkerCounts["models"][number]>();
  for (const m of view.machines) {
    for (const n of m.nodes) {
      if (nodeBusy(m, n) === 0) continue;
      c.held += heldCount(n);
      for (const a of holders(n)) {
        c[agentState(a) as "starting" | "running" | "finishing"] += 1;
        const model = modelLabel(a), seen = models.get(model);
        if (seen) { seen.count += 1; if (seen.cls !== a.intelligenceClass) seen.cls = null; }
        else models.set(model, { model, count: 1, cls: a.intelligenceClass });
      }
    }
    const own = machineSlots(m);
    c.slots += own.slots; c.busy += own.busy; c.workers += own.workers; c.workersBusy += own.workersBusy;
    c.machines.push({ id: m.id, label: m.label, state: shownMachineState(m), live: drawsSlots(m), ...own });
  }
  c.models = [...models.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  return c;
}
/** "5 of 16 slots busy on 2 workers": a worker is a worker node, counted while one of its slots is busy. */
export function busyOnWorkers(c: { busy: number; slots: number; workersBusy: number }): string {
  return `${busyOf(c.busy, c.slots)}${c.busy > 0 ? ` on ${plural(c.workersBusy, "worker")}` : ""}`;
}
/** A machine's share of the count line: "Fixture desktop: 5 of 16 slots busy". */
export function machineShare(m: WorkerCounts["machines"][number]): string {
  if (!m.live) return `${m.label}: ${m.state}`;
  return `${m.label}: ${busyOf(m.busy, m.slots)}${m.state === "holding" ? " · holding" : ""}`;
}
/** "7 of 20 slots busy on 3 workers". */
export function workerHeadline(c: WorkerCounts): string {
  return c.slots === 0 ? "No slots" : busyOnWorkers(c);
}
/** The busy slots by phase. Zero parts are left out. */
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
