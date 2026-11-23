import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { agentClassLabel, type AgentView, type MachineView, type NodeView, type SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { SLOT_LABEL, agentLines, agentState, busyOf, busyOnWorkers, heldCount, holdingNodes, levelKey, machineSlots, nodeBusy, nodeSlots, nodeStanding, overSlots, shownMachineState, slotCapacity, slotColumns, taskLabel, type Level, type NodeSlot } from "./slots";

export type Selection =
  | { kind: "server" } | { kind: "machine"; machineId: string } | { kind: "node"; nodeId: string }
  | { kind: "agent"; sessionId: string } | { kind: "free"; nodeId: string; index: number } | { kind: "held"; nodeId: string; index: number }
  | { kind: "waiting" } | { kind: "waitingAgent"; taskId: string };
export type CardKind = "server" | "machine" | "node" | "agent" | "free" | "held" | "waiting" | "waitingAgent";
/** What an agent card shows, sized to be read: the task, who runs it, on what, in which phase and since when. */
export type AgentCard = { title: string; who: string; what: string; phase: "starting" | "running" | "finishing" | "stopped"; startedAt: string | null; level: Level | null };
interface CardFields {
  kind: CardKind; selection: Selection; label: string; sub: string | null; reason: string | null;
  state: MachineView["state"] | null; machineKind: "local" | "cloud" | "unknown" | null;
  meters: { label: "CPU" | "RAM"; percent: number }[] | null; stale: boolean;
  intelligenceClass: "fast" | "standard" | "deep" | null; provider: string | null; ariaLabel: string;
  /** An agent card's facts; null for every other card. */
  agent: AgentCard | null;
  /** The slot's number on its node, from one; null for a card that is not a slot, or a row that has none. */
  slot: number | null;
  /** An attempt beyond its node's slots: drawn, and flagged. */
  over: boolean;
  /** Full text for a truncated pill (title attribute). */
  tooltip: string | null;
  /** Layout box; the height follows the text lines so no card overflows. */
  box: { width: number; height: number };
}
export interface SwarmCardData extends CardFields, Record<string, unknown> {}
export const CARD_SIZE: Record<CardKind | "machineMeters", { width: number; height: number }> = {
  server: { width: 160, height: 48 }, machine: { width: 240, height: 52 }, machineMeters: { width: 240, height: 88 },
  // A busy slot is a full card; a free slot is a smaller, quieter one in the same place (`SLOT_CELL`).
  node: { width: 264, height: 48 }, agent: { width: 264, height: 110 }, free: { width: 168, height: 56 }, held: { width: 264, height: 110 },
  waiting: { width: 190, height: 48 }, waitingAgent: { width: 230, height: 26 },
};
/** The place every slot card of a node takes, busy or free, so the tree keeps its shape as attempts start and finish. */
export const SLOT_CELL = CARD_SIZE.agent;
export const HELD_TEXT = "An attempt holds this slot and no agent is listed for it: the agent is starting, or it stopped and its result is being settled.";

function nodeSelectionId(selection: Extract<Selection, { nodeId: string }>) {
  if (selection.kind === "node") return `node:${selection.nodeId}`;
  return `${selection.kind}:${selection.nodeId}:${selection.index}`;
}
export function selectionId(s: Selection): string {
  switch (s.kind) {
    case "server":
    case "waiting": return s.kind;
    case "machine": return `machine:${s.machineId}`;
    case "agent": return `agent:${s.sessionId}`;
    case "waitingAgent": return `waiting-agent:${s.taskId}`;
    default: return nodeSelectionId(s);
  }
}

export function showWaiting(view: SwarmView, ready: number | null): boolean {
  return view.waiting.agents.length > 0 || (ready !== null && ready > 0 && view.waiting.reasons.length > 0);
}

type Card = Omit<CardFields, "ariaLabel" | "box" | "tooltip"> & { tooltip?: string | null; ariaLabel?: string };
// Text is 13px (title) and 12px (rest) at zoom 1; these estimate how many lines a card needs.
const CHAR_WIDTH = 6.8, LINE_HEIGHT = 16, PADDING = 14;
const wrapped = (text: string, width: number) => text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length * CHAR_WIDTH) / (width - 22))), 0);
function boxFor(card: Card): { width: number; height: number } {
  const size = card.kind === "machine" && card.meters ? CARD_SIZE.machineMeters : CARD_SIZE[card.kind];
  if (["agent", "free", "held", "waitingAgent"].includes(card.kind)) return size;
  const lines = (card.sub ? wrapped(card.sub, size.width) : 0) + (card.reason ? wrapped(card.reason, size.width) : 0);
  const height = PADDING + 17 + lines * LINE_HEIGHT + (card.meters ? card.meters.length * 14 + 6 : 0);
  return { width: size.width, height: Math.max(size.height, height) };
}
function node(card: Card): Node<SwarmCardData> {
  const ariaLabel = card.ariaLabel ?? `${card.label}${card.sub ? `, ${card.sub}` : ""}${card.reason ? `, ${card.reason.replace(/\n/g, ", ")}` : ""}`;
  return { id: selectionId(card.selection), type: "card", position: { x: 0, y: 0 }, ariaLabel, data: { ...card, tooltip: card.tooltip ?? null, ariaLabel, box: boxFor(card) } };
}
const base = (selection: Selection, label: string): Card => ({
  kind: selection.kind, selection, label, sub: null, reason: null, state: null, machineKind: null, meters: null, stale: false, intelligenceClass: null, provider: null, agent: null, slot: null, over: false,
});

const NO_CHILDREN = new Set<MachineView["state"]>(["offline", "stopped", "booting"]);

function machineSub(m: MachineView, now: string): string {
  switch (shownMachineState(m)) {
    case "offline": return m.lastSeenAt ? `${m.kind} · offline ${formatAge(now, m.lastSeenAt)}` : `${m.kind} · offline`;
    case "stopped": return `${m.kind} · stopped`;
    case "booting": return `${m.kind} · booting`;
    case "unknown": return `${m.kind} · state unknown`;
    default: return `${m.kind} · ${m.hardware?.logicalCpus ?? "?"} cores · ${busyOnWorkers(machineSlots(m))}`;
  }
}
/** A hold is the node's own: the machine names the nodes that hold in this response, and nothing when none does. */
function machineHold(m: MachineView): string | null {
  const holders = holdingNodes(m);
  if (holders.length === 0) return null;
  if (m.nodes.length === 1) return `holding: ${holders[0]!.holding[0]!.message}`;
  return `holding: ${holders.slice(0, 2).map(n => n.name).join(", ")}${holders.length > 2 ? ` +${holders.length - 2} more` : ""}`;
}
const STANDING_TEXT = { holding: "holding", draining: "draining", stopped: "stopped", offline: "offline", booting: "booting", revoked: "revoked", unknown: "state unknown" } as const;
const STANDING_STATE = { holding: "holding", draining: "holding", stopped: "stopped", offline: "offline", booting: "booting", revoked: "offline", unknown: "unknown" } as const;

/** The tag on a row that has no slot of its node. */
export const NO_SLOT = "No slot";
/** What a worker node says under its name: what it is doing instead of taking work, or "3 of 8 slots busy". */
export function nodeLine(m: MachineView, w: NodeView, now: string): string {
  const why = nodeStanding(m, w), seen = w.lastSeenAt ?? m.lastSeenAt;
  if (why.standing === "offline") return `offline${seen ? ` · last seen ${formatAge(now, seen)}` : ""}`;
  if (why.standing && why.standing !== "holding") return STANDING_TEXT[why.standing];
  return busyOf(nodeBusy(m, w), slotCapacity(w));
}
/** The flag on a node that holds more attempts than it has slots. */
export function overText(m: MachineView, w: NodeView): string {
  return `more agents than slots: ${nodeBusy(m, w)} on ${slotCapacity(w)}`;
}

function manualTitle(agent: AgentView) {
  if (!agent.manual) return;
  const names: Partial<Record<typeof agent.manual.status, string>> = { running: "Ready", pending: "Pending", preparing: "Starting" };
  const label = names[agent.manual.status] ?? agent.manual.status;
  return `${label} · ${agent.project.label}`;
}
function cardLevel(agent: AgentView) {
  return agent.routingProfile?.displayName ?? agent.manual?.spec.profile_name ?? agent.ranWith?.level
    ?? (agent.routingProfile === undefined ? agent.intelligenceClass : null);
}
/** The facts on an agent card: title first, then role and level, then model and effort. */
export function agentCard(a: AgentView): AgentCard {
  const phase = agentState(a), lines = agentLines(a);
  const manual = manualTitle(a);
  const level = cardLevel(a);
  return {
    title: manual || taskLabel(a), who: [a.ranWith?.role, level].filter(Boolean).join(" · ") || agentClassLabel(a), what: lines.what,
    phase, startedAt: a.startedAt, level: levelKey(a),
  };
}

type GraphOptions = { host: string; ready: number | null; now: string; stale?: boolean };
type Graph = { nodes: Node<SwarmCardData>[]; edges: Edge[] };
function link(graph: Graph, source: string, target: string, extra: Partial<Edge> = {}) {
  graph.edges.push({ id: `${source}->${target}`, source, target, ...extra });
}
function agentCardState(agent: AgentView, phase: AgentCard["phase"]): MachineView["state"] | null {
  if (!agent.manual) return phase === "starting" || phase === "finishing" ? "booting" : null;
  if (agent.manual.status === "running") return "online";
  return ["stopped", "failed"].includes(agent.manual.status) ? "stopped" : "booting";
}
function agentSlotCard(slot: Extract<NodeSlot, { kind: "agent" }>, place: string | null) {
  const a = slot.agent, card = agentCard(a);
  const beyond = slot.slot === null && card.phase !== "stopped";
  const phase = card.phase === "running" ? null : SLOT_LABEL[card.phase];
  return node({
    ...base({ kind: "agent", sessionId: a.sessionId }, card.title),
    agent: card, slot: slot.slot, over: beyond, intelligenceClass: a.intelligenceClass, provider: a.provider,
    ariaLabel: [card.title, card.who, phase, card.what, beyond ? NO_SLOT : place].filter(Boolean).join(" "),
    tooltip: [card.title, a.project.label, card.who, phase, card.what].filter(Boolean).join(" · "), state: agentCardState(a, card.phase),
  });
}
function slotCard(slot: NodeSlot, worker: NodeView) {
  const place = slot.slot === null ? null : `Slot ${slot.slot}`;
  if (slot.kind === "agent") return agentSlotCard(slot, place);
  const selection = { kind: slot.kind, nodeId: worker.id, index: slot.index };
  if (slot.kind === "held") return node({
    ...base(selection, "slot held"), slot: slot.slot, over: slot.slot === null, sub: "starting or settling", tooltip: HELD_TEXT,
    ariaLabel: `${place ?? NO_SLOT} slot held starting or settling`,
  });
  const label = slot.standing ? STANDING_TEXT[slot.standing] : "free";
  return node({ ...base(selection, label), slot: slot.slot, state: slot.standing ? STANDING_STATE[slot.standing] : null, ariaLabel: `${place} ${label}` });
}
function workerCard(machine: MachineView, worker: NodeView, opts: GraphOptions) {
  const why = nodeStanding(machine, worker), over = overSlots(machine, worker);
  const reason = [worker.holding[0] ? `holding: ${worker.holding[0].message}` : null, over > 0 ? overText(machine, worker) : null].filter(Boolean).join("\n");
  return node({
    ...base({ kind: "node", nodeId: worker.id }, worker.name), sub: nodeLine(machine, worker, opts.now),
    reason: reason || null, over: over > 0, state: why.standing ? STANDING_STATE[why.standing] : null,
  });
}
function addWorker(graph: Graph, machine: MachineView, worker: NodeView, opts: GraphOptions) {
  const card = workerCard(machine, worker, opts);
  graph.nodes.push(card);
  link(graph, selectionId({ kind: "machine", machineId: machine.id }), card.id, { type: "bus" });
  for (const slot of nodeSlots(machine, worker)) {
    const child = slotCard(slot, worker);
    graph.nodes.push(child);
    link(graph, card.id, child.id);
  }
}
function machineCard(machine: MachineView, opts: GraphOptions) {
  const load = machine.load;
  const meters = load !== null && machine.state !== "offline" ? [
    { label: "CPU" as const, percent: load.cpuPercent }, { label: "RAM" as const, percent: load.memoryPercent },
  ] : null;
  return node({
    ...base({ kind: "machine", machineId: machine.id }, machine.label), sub: machineSub(machine, opts.now), reason: machineHold(machine),
    state: shownMachineState(machine), machineKind: machine.kind, meters, stale: load !== null && !load.fresh,
  });
}
function machineEdge(machine: MachineView, opts: GraphOptions) {
  const state = shownMachineState(machine);
  const live = state === "online" || state === "holding";
  const agentCount = machine.nodes.reduce((n, w) => n + w.agents.length + heldCount(w), 0);
  return {
    ...(live && agentCount > 0 && !opts.stale ? { animated: true } : {}),
    ...(NO_CHILDREN.has(machine.state) ? { style: { strokeDasharray: "5 4" } } : {}),
  };
}
export function buildSwarmGraph(view: SwarmView, opts: GraphOptions): Graph {
  const root = node({ ...base({ kind: "server" }, "AQ server"), sub: opts.host });
  const graph: Graph = { nodes: [root], edges: [] };
  for (const machine of view.machines) {
    const card = machineCard(machine, opts);
    graph.nodes.push(card);
    link(graph, root.id, card.id, machineEdge(machine, opts));
    if (!NO_CHILDREN.has(machine.state)) for (const worker of machine.nodes) addWorker(graph, machine, worker, opts);
  }
  // Waiting work is shown in the headline and server pane.
  return graph;
}

/** Waiting agents grow downwards in two columns within a bounded footprint, rather than becoming dagre siblings. A node's slot cards take `slotColumns`. */
export const SLOT_COLUMNS = 2;
const SLOT_GAP = 14, SLOT_ROW_GAP = 14, SLOT_HEADER_GAP = 46;
/** A node's slot cards sit close under it: the two read as one unit. */
const NODE_SLOT_GAP = 8;
/** A machine's nodes wrap into rows of this many, so a machine with eight nodes is two rows and its cards stay large. */
export const NODE_COLUMNS = 4;
/** Between the server, its machines and their nodes; and between the rows of a machine's nodes. */
export const RANK_GAP = 36;
const NODE_ROW_GAP = 30, SIBLING_GAP = 28;
const slotGap = (parent: Node<SwarmCardData>) => (parent.data.kind === "node" ? NODE_SLOT_GAP : SLOT_HEADER_GAP);

export function layoutSwarm(nodes: Node<SwarmCardData>[], edges: Edge[], rankdir: "TB" | "LR" = "TB", nodeColumns: number = NODE_COLUMNS): Node<SwarmCardData>[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const groups = new Map<string, Node<SwarmCardData>[]>();
  const owner = new Map<string, string>();
  for (const e of edges) {
    const parent = byId.get(e.source), child = byId.get(e.target);
    if (!parent || !child || !["node", "waiting"].includes(parent.data.kind) || !["agent", "free", "held", "waitingAgent"].includes(child.data.kind)) continue;
    const children = groups.get(parent.id) ?? [];
    children.push(child); groups.set(parent.id, children); owner.set(child.id, parent.id);
  }
  const footprints = new Map<string, { width: number; height: number; columnWidth: number; rowHeight: number; columns: number }>();
  const g = new dagre.graphlib.Graph(); g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir, nodesep: 28, ranksep: 46 });
  for (const n of nodes) {
    if (owner.has(n.id)) continue;
    const children = groups.get(n.id) ?? [];
    // Under a node every slot takes one cell of one size, whatever it holds; a free card is smaller and sits in the middle of its cell.
    const cell = n.data.kind === "node" && children.length ? SLOT_CELL : { width: 0, height: 0 };
    const columnWidth = Math.max(cell.width, ...children.map(c => c.data.box.width));
    const rowHeight = Math.max(cell.height, ...children.map(c => c.data.box.height));
    const columns = n.data.kind === "node" ? slotColumns(children.length) : Math.min(SLOT_COLUMNS, children.length), rows = columns ? Math.ceil(children.length / columns) : 0;
    const footprint = {
      width: Math.max(n.data.box.width, columns * columnWidth + Math.max(0, columns - 1) * SLOT_GAP),
      height: n.data.box.height + (rows ? slotGap(n) + rows * rowHeight + (rows - 1) * SLOT_ROW_GAP : 0),
      columnWidth, rowHeight, columns,
    };
    footprints.set(n.id, footprint); g.setNode(n.id, footprint);
  }
  for (const e of edges) if (!owner.has(e.target) && !owner.has(e.source)) g.setEdge(e.source, e.target);
  // Reserve complete branches, including waiting slots beside machine descendants.
  // Dagre centres boxes within each rank; a tall slot grid would otherwise push
  // a short sibling's heading far below its parent. Top-align sibling subtrees.
  if (rankdir === "TB") {
    const children = new Map<string, string[]>();
    const parentIds = new Set<string>();
    for (const e of edges) {
      if (owner.has(e.target) || owner.has(e.source)) continue;
      const siblings = children.get(e.source) ?? [];
      siblings.push(e.target); children.set(e.source, siblings); parentIds.add(e.target);
    }
    // A machine's nodes are a grid: rows of at most `nodeColumns`, each column as wide as its widest branch and each
    // row as tall as its tallest. Every other parent keeps its children in one row.
    const perRow = (id: string) => (byId.get(id)!.data.kind === "machine" ? Math.max(1, Math.floor(nodeColumns)) : Infinity);
    type Branch = { width: number; height: number; columns: number[]; rows: number[] };
    const branches = new Map<string, Branch>();
    const measure = (id: string): Branch => {
      const own = footprints.get(id)!;
      const descendants = (children.get(id) ?? []).map(measure);
      const wrap = Math.min(perRow(id), Math.max(1, descendants.length));
      const columns: number[] = [], rows: number[] = [];
      descendants.forEach((d, i) => {
        const c = i % wrap, r = Math.floor(i / wrap);
        columns[c] = Math.max(columns[c] ?? 0, d.width); rows[r] = Math.max(rows[r] ?? 0, d.height);
      });
      const sum = (values: number[], gap: number) => values.reduce((total, v) => total + v, 0) + Math.max(0, values.length - 1) * gap;
      const branch = {
        width: Math.max(own.width, sum(columns, SIBLING_GAP)),
        height: own.height + (descendants.length ? RANK_GAP + sum(rows, NODE_ROW_GAP) : 0),
        columns, rows,
      };
      branches.set(id, branch); return branch;
    };
    const roots = nodes.filter(n => !owner.has(n.id) && !parentIds.has(n.id));
    roots.forEach(n => measure(n.id));
    const positions = new Map<string, { x: number; y: number }>();
    const place = (id: string, left: number, top: number, width: number) => {
      const card = byId.get(id)!, branch = branches.get(id)!, own = footprints.get(id)!;
      positions.set(id, { x: left + (width - card.data.box.width) / 2, y: top });
      const slots = groups.get(id) ?? [];
      const columns = Math.max(1, own.columns);
      const gridWidth = columns * own.columnWidth + Math.max(0, columns - 1) * SLOT_GAP;
      slots.forEach((slot, index) => positions.set(slot.id, {
        x: left + (width - gridWidth) / 2 + (index % columns) * (own.columnWidth + SLOT_GAP) + (own.columnWidth - slot.data.box.width) / 2,
        y: top + card.data.box.height + slotGap(card) + Math.floor(index / columns) * (own.rowHeight + SLOT_ROW_GAP) + (own.rowHeight - slot.data.box.height) / 2,
      }));
      const descendants = children.get(id) ?? [];
      const wrap = Math.max(1, branch.columns.length);
      const totalWidth = branch.columns.reduce((total, w) => total + w, 0) + Math.max(0, branch.columns.length - 1) * SIBLING_GAP;
      let rowTop = top + own.height + RANK_GAP;
      for (let r = 0; r * wrap < descendants.length; r++) {
        let childLeft = left + (width - totalWidth) / 2;
        descendants.slice(r * wrap, (r + 1) * wrap).forEach((child, c) => {
          place(child, childLeft, rowTop, branch.columns[c]!);
          childLeft += branch.columns[c]! + SIBLING_GAP;
        });
        rowTop += branch.rows[r]! + NODE_ROW_GAP;
      }
    };
    let left = 0;
    for (const root of roots) { const width = branches.get(root.id)!.width; place(root.id, left, 0, width); left += width + SIBLING_GAP; }
    return nodes.map(n => ({ ...n, position: positions.get(n.id)!, width: n.data.box.width, height: n.data.box.height }));
  }
  dagre.layout(g);
  return nodes.map(n => {
    const parentId = owner.get(n.id);
    const footprint = footprints.get(parentId ?? n.id)!;
    const p = g.node(parentId ?? n.id);
    const left = p.x - footprint.width / 2, top = p.y - footprint.height / 2;
    let x = left + (footprint.width - n.data.box.width) / 2, y = top;
    if (parentId) {
      const children = groups.get(parentId)!;
      const columns = Math.max(1, footprint.columns);
      const index = children.indexOf(n), column = index % columns, row = Math.floor(index / columns);
      const gridWidth = columns * footprint.columnWidth + (columns - 1) * SLOT_GAP;
      x = left + (footprint.width - gridWidth) / 2 + column * (footprint.columnWidth + SLOT_GAP) + (footprint.columnWidth - n.data.box.width) / 2;
      y += byId.get(parentId)!.data.box.height + slotGap(byId.get(parentId)!) + row * (footprint.rowHeight + SLOT_ROW_GAP) + (footprint.rowHeight - n.data.box.height) / 2;
    }
    return { ...n, position: { x, y }, width: n.data.box.width, height: n.data.box.height };
  });
}

/** The box around every placed card. */
export function treeBounds(placed: Node<SwarmCardData>[]): { x: number; y: number; width: number; height: number } {
  if (placed.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...placed.map(n => n.position.x)), y = Math.min(...placed.map(n => n.position.y));
  return { x, y, width: Math.max(...placed.map(n => n.position.x + n.data.box.width)) - x, height: Math.max(...placed.map(n => n.position.y + n.data.box.height)) - y };
}

/** How the tree sits in its canvas when it opens: whole, as large as it can be drawn between these zooms, with this margin. */
export const FIT = { padding: 0.03, minZoom: 0.25, maxZoom: 1.6 } as const;
/** A phone-width canvas cannot show a whole fleet legibly: there the tree opens no smaller than this, and the viewer pans. */
const NARROW = { width: 640, minZoom: 0.5 } as const;
export const minFitZoom = (canvas: { width: number }) => (canvas.width < NARROW.width ? NARROW.minZoom : FIT.minZoom);
/** The zoom at which a box of this size fills the canvas, margins kept. Not clamped. */
export function fitZoom(bounds: { width: number; height: number }, canvas: { width: number; height: number }): number {
  if ([bounds.width, bounds.height, canvas.width, canvas.height].some(value => value <= 0)) return 1;
  const room = 1 - 2 * FIT.padding;
  return Math.min(canvas.width * room / bounds.width, canvas.height * room / bounds.height);
}
/**
 * The viewport that shows the whole tree centred in the canvas, as large as it fits (never above `FIT.maxZoom`). A tree
 * that cannot fit at the smallest opening zoom opens at that zoom with the server root at the top centre; the user pans.
 */
export function fitViewport(placed: Node<SwarmCardData>[], canvas: { width: number; height: number }, edges: Edge[] = []): { x: number; y: number; zoom: number } | null {
  if (placed.length === 0 || canvas.width <= 0 || canvas.height <= 0) return null;
  const bounds = fitBounds(placed, edges), wanted = fitZoom(bounds, canvas);
  const least = minFitZoom(canvas);
  if (wanted < least) {
    const root = placed.find(n => n.id === "server") ?? placed[0]!;
    return { x: canvas.width / 2 - (root.position.x + root.data.box.width / 2) * least, y: 24 - root.position.y * least, zoom: least };
  }
  const zoom = Math.min(FIT.maxZoom, wanted);
  return { x: (canvas.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (canvas.height - bounds.height * zoom) / 2 - bounds.y * zoom, zoom };
}

/**
 * Lays the tree out for a canvas: of the ways to wrap each machine's nodes into rows, the one that draws the cards
 * largest. Without a canvas size it wraps at `NODE_COLUMNS`.
 */
export function layoutForCanvas(nodes: Node<SwarmCardData>[], edges: Edge[], canvas: { width: number; height: number } | null, keep?: number): { nodes: Node<SwarmCardData>[]; columns: number } {
  if (keep) return { nodes: layoutSwarm(nodes, edges, "TB", keep), columns: keep };
  const byId = new Map(nodes.map(n => [n.id, n]));
  const perMachine = new Map<string, number>();
  for (const e of edges) if (byId.get(e.source)?.data.kind === "machine" && byId.get(e.target)?.data.kind === "node") perMachine.set(e.source, (perMachine.get(e.source) ?? 0) + 1);
  const most = Math.max(1, ...perMachine.values());
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return { nodes: layoutSwarm(nodes, edges, "TB", NODE_COLUMNS), columns: NODE_COLUMNS };
  let best: { nodes: Node<SwarmCardData>[]; columns: number; zoom: number } | null = null;
  // Every wrap that gives a different number of rows, widest first; a tie keeps the wider one.
  const tried = new Set<number>();
  for (let rows = 1; rows <= Math.min(most, 6); rows++) {
    const columns = Math.ceil(most / rows);
    if (tried.has(columns)) continue;
    tried.add(columns);
    const placed = layoutSwarm(nodes, edges, "TB", columns), zoom = fitZoom(fitBounds(placed, edges), canvas);
    if (!best || zoom > best.zoom + 1e-9) best = { nodes: placed, columns, zoom };
  }
  return { nodes: best!.nodes, columns: best!.columns };
}

/**
 * Where a machine's edges to its nodes run, so none crosses a card: down from the machine to a lane, along it, and down
 * to the node. A node in a lower row is reached through the gap beside its column.
 */
export function routeEdges(placed: Node<SwarmCardData>[], edges: Edge[]): Edge[] {
  const byId = new Map(placed.map(n => [n.id, n]));
  const kids = new Map<string, string[]>();
  for (const e of edges) kids.set(e.source, [...(kids.get(e.source) ?? []), e.target]);
  // A node's footprint: its card and the slot cards under it.
  const footprint = (id: string) => {
    const cards = [byId.get(id)!, ...(kids.get(id) ?? []).map(k => byId.get(k)!).filter(Boolean)];
    return { left: Math.min(...cards.map(c => c.position.x)), right: Math.max(...cards.map(c => c.position.x + c.data.box.width)) };
  };
  return edges.map(e => {
    const source = byId.get(e.source), target = byId.get(e.target);
    // A node's slots sit in its frame (`slotFrames`): the frame says whose they are, so no line is drawn to each.
    if (source?.data.kind === "node" && target) return { ...e, hidden: true };
    if (!source || !target || source.data.kind !== "machine" || target.data.kind !== "node") return e;
    const siblings = (kids.get(e.source) ?? []).map(id => byId.get(id)!).filter(n => n && n.data.kind === "node");
    const firstRow = Math.min(...siblings.map(n => n.position.y));
    const lane = target.position.y - 12;
    if (target.position.y <= firstRow) return { ...e, type: "bus", data: { lane, upper: null, gutter: null } };
    const centre = target.position.x + target.data.box.width / 2;
    const above = siblings.filter(n => n.position.y < target.position.y).map(n => footprint(n.id));
    const leftOf = above.filter(f => (f.left + f.right) / 2 < centre - 1).map(f => f.right);
    const gutter = leftOf.length ? Math.max(...leftOf) + SIBLING_GAP / 2 : Math.min(footprint(target.id).left, ...above.map(f => f.left)) - SIBLING_GAP / 2;
    return { ...e, type: "bus", data: { lane, upper: source.position.y + source.data.box.height + 10, gutter } };
  });
}

/** How far a worker's frame stands off its cards. */
export const FRAME_PAD = 7;
/**
 * The box around each worker node and the places of its slots: drawn behind them, so a worker and its slots read as
 * one thing. It follows the slots' places, not the cards in them, so it does not change as attempts start and finish.
 */
export function slotFrames(placed: Node<SwarmCardData>[], edges: Edge[]): { id: string; x: number; y: number; width: number; height: number }[] {
  const frames: { id: string; x: number; y: number; width: number; height: number }[] = [];
  const count = new Map<string, number>();
  for (const e of edges) count.set(e.source, (count.get(e.source) ?? 0) + 1);
  for (const worker of placed) {
    const slots = count.get(worker.id) ?? 0;
    if (worker.data.kind !== "node" || slots === 0) continue;
    const columns = slotColumns(slots), rows = Math.ceil(slots / columns);
    const gridWidth = columns * SLOT_CELL.width + (columns - 1) * SLOT_GAP, gridHeight = rows * SLOT_CELL.height + (rows - 1) * SLOT_ROW_GAP;
    const centre = worker.position.x + worker.data.box.width / 2, left = Math.min(worker.position.x, centre - gridWidth / 2), right = Math.max(worker.position.x + worker.data.box.width, centre + gridWidth / 2);
    frames.push({ id: `frame:${worker.id}`, x: left - FRAME_PAD, y: worker.position.y - FRAME_PAD, width: right - left + 2 * FRAME_PAD, height: worker.data.box.height + NODE_SLOT_GAP + gridHeight + 2 * FRAME_PAD });
  }
  return frames;
}
/** The box the tree is fitted to: every card and every worker's frame. It keeps its size as attempts start and finish. */
export function fitBounds(placed: Node<SwarmCardData>[], edges: Edge[] = []): { x: number; y: number; width: number; height: number } {
  const b = treeBounds(placed), frames = slotFrames(placed, edges);
  if (frames.length === 0) return b;
  const x = Math.min(b.x, ...frames.map(f => f.x)), y = Math.min(b.y, ...frames.map(f => f.y));
  return { x, y, width: Math.max(b.x + b.width, ...frames.map(f => f.x + f.width)) - x, height: Math.max(b.y + b.height, ...frames.map(f => f.y + f.height)) - y };
}
