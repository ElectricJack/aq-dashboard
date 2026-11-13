import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { agentClassLabel, type MachineView, type NodeView, type SwarmView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";

export type Selection =
  | { kind: "server" } | { kind: "machine"; machineId: string } | { kind: "node"; nodeId: string }
  | { kind: "agent"; sessionId: string } | { kind: "free"; nodeId: string; index: number }
  | { kind: "waiting" } | { kind: "waitingAgent"; taskId: string };
export type CardKind = "server" | "machine" | "node" | "agent" | "free" | "waiting" | "waitingAgent";
interface CardFields {
  kind: CardKind; selection: Selection; label: string; sub: string | null; reason: string | null;
  state: MachineView["state"] | null; machineKind: "local" | "cloud" | "unknown" | null;
  meters: { label: "CPU" | "RAM"; percent: number }[] | null; stale: boolean;
  intelligenceClass: "fast" | "standard" | "deep" | null; provider: string | null; ariaLabel: string;
  /** Full text for a truncated pill (title attribute). */
  tooltip: string | null;
  /** Layout box; the height follows the text lines so no card overflows. */
  box: { width: number; height: number };
}
export interface SwarmCardData extends CardFields, Record<string, unknown> {}
export const CARD_SIZE: Record<CardKind | "machineMeters", { width: number; height: number }> = {
  server: { width: 160, height: 48 }, machine: { width: 240, height: 52 }, machineMeters: { width: 240, height: 88 },
  node: { width: 190, height: 48 }, agent: { width: 130, height: 26 }, free: { width: 120, height: 26 },
  waiting: { width: 190, height: 48 }, waitingAgent: { width: 230, height: 26 },
};
export const MAX_FREE_PILLS = 8;

export function selectionId(s: Selection): string {
  switch (s.kind) {
    case "server": return "server";
    case "machine": return `machine:${s.machineId}`;
    case "node": return `node:${s.nodeId}`;
    case "agent": return `agent:${s.sessionId}`;
    case "free": return `free:${s.nodeId}:${s.index}`;
    case "waiting": return "waiting";
    case "waitingAgent": return `waiting-agent:${s.taskId}`;
  }
}

export function showWaiting(view: SwarmView, ready: number | null): boolean {
  return view.waiting.agents.length > 0 || (ready !== null && ready > 0 && view.waiting.reasons.length > 0);
}

type Card = Omit<CardFields, "ariaLabel" | "box" | "tooltip"> & { tooltip?: string | null };
// Text is 13px (title) and 12px (rest) at zoom 1; these estimate how many lines a card needs.
const CHAR_WIDTH = 6.8, LINE_HEIGHT = 16, PADDING = 14;
const wrapped = (text: string, width: number) => text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil((line.length * CHAR_WIDTH) / (width - 22))), 0);
function boxFor(card: Card): { width: number; height: number } {
  const size = card.kind === "machine" && card.meters ? CARD_SIZE.machineMeters : CARD_SIZE[card.kind];
  if (card.kind === "agent" || card.kind === "free" || card.kind === "waitingAgent") return size;
  const lines = (card.sub ? wrapped(card.sub, size.width) : 0) + (card.reason ? wrapped(card.reason, size.width) : 0);
  const height = PADDING + 17 + lines * LINE_HEIGHT + (card.meters ? card.meters.length * 14 + 6 : 0);
  return { width: size.width, height: Math.max(size.height, height) };
}
function node(card: Card): Node<SwarmCardData> {
  const ariaLabel = `${card.label}${card.sub ? `, ${card.sub}` : ""}${card.reason ? `, ${card.reason.replace(/\n/g, ", ")}` : ""}`;
  return { id: selectionId(card.selection), type: "card", position: { x: 0, y: 0 }, ariaLabel, data: { ...card, tooltip: card.tooltip ?? null, ariaLabel, box: boxFor(card) } };
}
const base = (kind: CardKind, selection: Selection, label: string): Card => ({
  kind, selection, label, sub: null, reason: null, state: null, machineKind: null, meters: null, stale: false, intelligenceClass: null, provider: null,
});

const NO_CHILDREN = new Set<MachineView["state"]>(["offline", "stopped", "booting"]);

function machineSub(m: MachineView, now: string): string {
  switch (m.state) {
    case "offline": return m.lastSeenAt ? `${m.kind} · offline ${formatAge(now, m.lastSeenAt)}` : `${m.kind} · offline`;
    case "stopped": return `${m.kind} · stopped`;
    case "booting": return `${m.kind} · booting`;
    case "unknown": return `${m.kind} · state unknown`;
    default: return `${m.kind} · ${m.hardware?.logicalCpus ?? "?"} cores${m.agentMax!==null?` · max ${m.agentMax} agents`:""}`;
  }
}

export function buildSwarmGraph(view: SwarmView, opts: { host: string; ready: number | null; now: string; stale?: boolean }): { nodes: Node<SwarmCardData>[]; edges: Edge[] } {
  const nodes: Node<SwarmCardData>[] = [];
  const edges: Edge[] = [];
  nodes.push(node({ ...base("server", { kind: "server" }, "AQ server"), sub: opts.host }));
  const link = (source: string, target: string, extra: Partial<Edge> = {}) => edges.push({ id: `${source}->${target}`, source, target, ...extra });

  for (const m of view.machines) {
    const selection: Selection = { kind: "machine", machineId: m.id };
    const id = selectionId(selection);
    const agentCount = m.nodes.reduce((n, w) => n + w.agents.length, 0);
    nodes.push(node({
      ...base("machine", selection, m.label), sub: machineSub(m, opts.now),
      reason: m.state === "holding" && m.holding[0] ? `holding: ${m.holding[0].message}` : null,
      state: m.state, machineKind: m.kind,
      meters: m.load !== null && m.state !== "offline" ? [{ label: "CPU", percent: m.load.cpuPercent }, { label: "RAM", percent: m.load.memoryPercent }] : null,
      stale: m.load !== null && !m.load.fresh,
    }));
    const live = m.state === "online" || m.state === "holding";
    link("server", id, {
      ...(live && agentCount > 0 && !opts.stale ? { animated: true } : {}),
      ...(m.state === "offline" || m.state === "stopped" || m.state === "booting" ? { style: { strokeDasharray: "5 4" } } : {}),
    });
    if (NO_CHILDREN.has(m.state)) continue;
    for (const w of m.nodes) addWorker(w, id);
  }

  function addWorker(w: NodeView, machineId: string) {
    const selection: Selection = { kind: "node", nodeId: w.id };
    const id = selectionId(selection);
    nodes.push(node({ ...base("node", selection, w.name), sub: w.slots.total===null?`${w.backendKind ?? "worker"} · capacity not reported`:`${w.slots.scope ?? w.backendKind ?? "worker"} · ${w.slots.occupied}/${w.slots.total} slots` }));
    link(machineId, id);
    for (const a of w.agents) {
      const s: Selection = { kind: "agent", sessionId: a.sessionId };
      nodes.push(node({ ...base("agent", s, `${a.harness ?? a.provider ?? "agent"} · ${agentClassLabel(a)}`), intelligenceClass: a.intelligenceClass, provider: a.provider, ...(a.manual?{label:`${a.manual.status==='running'?'Ready':a.manual.status==='pending'?'Pending':a.manual.status==='preparing'?'Starting':a.manual.status} · ${a.project.label}`,state:a.manual.status==='running'?'online' as const:['stopped','failed'].includes(a.manual.status)?'stopped' as const:'booting' as const,tooltip:`${agentClassLabel(a)} · ${a.manual.stage}`}: {}) }));
      link(id, selectionId(s));
    }
    const idle = w.slots.idle ?? 0;
    const pills = Math.min(idle, MAX_FREE_PILLS);
    for (let i = 0; i < pills; i++) {
      const s: Selection = { kind: "free", nodeId: w.id, index: i };
      const label = i === pills - 1 && idle > MAX_FREE_PILLS ? `+${idle - MAX_FREE_PILLS + 1} free` : "free";
      nodes.push(node(base("free", s, label)));
      link(id, selectionId(s));
    }
  }

  if (showWaiting(view, opts.ready)) {
    const firstReason = view.waiting.reasons[0]?.message ?? "";
    const sub = view.waiting.agents.length > 0 ? `${view.waiting.agents.length} agents · ${firstReason}` : `${opts.ready} ready tasks · ${firstReason}`;
    // The first reason is on the sub line; every further reason gets its own line.
    const more = view.waiting.reasons.slice(1).map(x => x.message).join("\n");
    nodes.push(node({ ...base("waiting", { kind: "waiting" }, "waiting"), sub, reason: more || null }));
    link("server", "waiting", { style: { strokeDasharray: "4 4", stroke: "#c7802e" } });
    for (const w of view.waiting.agents) {
      const s: Selection = { kind: "waitingAgent", taskId: w.taskId };
      const label = `${w.provider ?? "task"} · ${w.intelligenceClass ?? w.title}${w.reasons[0] ? ` — ${w.reasons[0].message}` : ""}`;
      nodes.push(node({ ...base("waitingAgent", s, label), intelligenceClass: w.intelligenceClass, provider: w.provider, tooltip: label }));
      link("waiting", selectionId(s), { style: { strokeDasharray: "3 3" } });
    }
  }
  return { nodes, edges };
}

/** Slots grow downwards within a bounded footprint, rather than becoming dagre siblings. */
export const SLOT_COLUMNS = 2;
const SLOT_GAP = 14, SLOT_ROW_GAP = 14, SLOT_HEADER_GAP = 46;

export function layoutSwarm(nodes: Node<SwarmCardData>[], edges: Edge[], rankdir: "TB" | "LR" = "TB"): Node<SwarmCardData>[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const groups = new Map<string, Node<SwarmCardData>[]>();
  const owner = new Map<string, string>();
  for (const e of edges) {
    const parent = byId.get(e.source), child = byId.get(e.target);
    if (!parent || !child || !["node", "waiting"].includes(parent.data.kind) || !["agent", "free", "waitingAgent"].includes(child.data.kind)) continue;
    const children = groups.get(parent.id) ?? [];
    children.push(child); groups.set(parent.id, children); owner.set(child.id, parent.id);
  }
  const footprints = new Map<string, { width: number; height: number; columnWidth: number; rowHeight: number }>();
  const g = new dagre.graphlib.Graph(); g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir, nodesep: 28, ranksep: 46 });
  for (const n of nodes) {
    if (owner.has(n.id)) continue;
    const children = groups.get(n.id) ?? [];
    const columnWidth = Math.max(0, ...children.map(c => c.data.box.width));
    const rowHeight = Math.max(0, ...children.map(c => c.data.box.height));
    const columns = Math.min(SLOT_COLUMNS, children.length), rows = Math.ceil(children.length / SLOT_COLUMNS);
    const footprint = {
      width: Math.max(n.data.box.width, columns * columnWidth + Math.max(0, columns - 1) * SLOT_GAP),
      height: n.data.box.height + (rows ? SLOT_HEADER_GAP + rows * rowHeight + (rows - 1) * SLOT_ROW_GAP : 0),
      columnWidth, rowHeight,
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
    const branches = new Map<string, { width: number; height: number }>();
    const measure = (id: string): { width: number; height: number } => {
      const own = footprints.get(id)!;
      const descendants = (children.get(id) ?? []).map(measure);
      const branch = {
        width: Math.max(own.width, descendants.reduce((sum, d) => sum + d.width, 0) + Math.max(0, descendants.length - 1) * 28),
        height: own.height + (descendants.length ? SLOT_HEADER_GAP + Math.max(...descendants.map(d => d.height)) : 0),
      };
      branches.set(id, branch); return branch;
    };
    const roots = nodes.filter(n => !owner.has(n.id) && !parentIds.has(n.id));
    roots.forEach(n => measure(n.id));
    const positions = new Map<string, { x: number; y: number }>();
    const place = (id: string, left: number, top: number) => {
      const card = byId.get(id)!, branch = branches.get(id)!, own = footprints.get(id)!;
      positions.set(id, { x: left + (branch.width - card.data.box.width) / 2, y: top });
      const slots = groups.get(id) ?? [];
      const columns = Math.min(SLOT_COLUMNS, slots.length);
      const gridWidth = columns * own.columnWidth + Math.max(0, columns - 1) * SLOT_GAP;
      slots.forEach((slot, index) => positions.set(slot.id, {
        x: left + (branch.width - gridWidth) / 2 + (index % SLOT_COLUMNS) * (own.columnWidth + SLOT_GAP) + (own.columnWidth - slot.data.box.width) / 2,
        y: top + card.data.box.height + SLOT_HEADER_GAP + Math.floor(index / SLOT_COLUMNS) * (own.rowHeight + SLOT_ROW_GAP),
      }));
      const descendants = children.get(id) ?? [];
      const totalWidth = descendants.reduce((sum, child) => sum + branches.get(child)!.width, 0) + Math.max(0, descendants.length - 1) * 28;
      let childLeft = left + (branch.width - totalWidth) / 2;
      for (const child of descendants) {
        place(child, childLeft, top + own.height + SLOT_HEADER_GAP);
        childLeft += branches.get(child)!.width + 28;
      }
    };
    let left = 0;
    for (const root of roots) { place(root.id, left, 0); left += branches.get(root.id)!.width + 28; }
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
      const index = children.indexOf(n), column = index % SLOT_COLUMNS, row = Math.floor(index / SLOT_COLUMNS);
      const columns = Math.min(SLOT_COLUMNS, children.length);
      const gridWidth = columns * footprint.columnWidth + (columns - 1) * SLOT_GAP;
      x = left + (footprint.width - gridWidth) / 2 + column * (footprint.columnWidth + SLOT_GAP) + (footprint.columnWidth - n.data.box.width) / 2;
      y += byId.get(parentId)!.data.box.height + SLOT_HEADER_GAP + row * (footprint.rowHeight + SLOT_ROW_GAP);
    }
    return { ...n, position: { x, y }, width: n.data.box.width, height: n.data.box.height };
  });
}
