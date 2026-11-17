import { describe, expect, it } from "vitest";
import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { CARD_SIZE, FIT, RANK_GAP, SLOT_CELL, buildSwarmGraph, fitBounds, fitViewport, layoutForCanvas, layoutSwarm, routeEdges, showWaiting, slotFrames, treeBounds } from "./graph";

const NOW = "2026-11-07T12:00:00.000Z";
const agent = (n: number, provider: string, cls: AgentView["intelligenceClass"]): AgentView => ({
  sessionId: `s${n}`, attemptId: `a${n}`, task: { id: `t${n}`, title: `Task ${n}` }, project: { id: "p", label: "proj" },
  provider, model: null, harness: null, intelligenceClass: cls, terminalId: `term${n}`, startedAt: null,
});
/** A node as the adapter gives it: `capacity` is the slot count the server reports, absent when it reports none. */
const worker = (id: string, total: number | null, occupied: number, idle: number | null, agents: AgentView[] = []): NodeView => ({
  ...(total === null ? {} : { capacity: total }),
  id, name: id, health: "online", service: "unreported", serviceSince: null, backendKind: "docker-local", workerVersion: "0.1.0",
  sandboxTemplates: [], agentChannel: "unreported", lastSeenAt: NOW, slots: { total, occupied, idle }, holding: [], agents,
});
const machine = (id: string, state: MachineView["state"], extra: Partial<MachineView> = {}): MachineView => ({
  id, label: id, kind: "local", state, holding: [], lastSeenAt: NOW, load: null, hardware: { logicalCpus: 8, memoryTotalBytes: 2 ** 34, diskTotalBytes: null, diskFreeBytes: null },
  agentMax: null, cost: null, control: null, controlUnrecognised: false, nodes: [], ...extra,
});
const load = (cpu: number, ram: number) => ({ source: "windows_host" as const, hostProbe: "fresh" as const, cpuPercent: cpu, memoryPercent: ram, cpuAvgPercent: cpu, memoryAvgPercent: ram, samples: 60, observedAt: NOW, fresh: true });
function view(): SwarmView {
  return {
    serverTime: NOW, server: { version: "0.1.0", sourceRevision: "85070006", runningAgents: 4, ownerAvailability: null },
    machines: [
      machine("desktop", "online", { hardware: { logicalCpus: 24, memoryTotalBytes: 2 ** 36, diskTotalBytes: null, diskFreeBytes: null }, agentMax: 5, load: load(61, 58),
        nodes: [worker("local-1", 3, 3, 0, [agent(1, "claude", "standard"), agent(2, "claude", "deep"), agent(3, "codex", "fast")]), worker("local-2", 2, 1, 1, [agent(4, "claude", "fast")])] }),
      machine("laptop", "offline", { lastSeenAt: "2026-11-07T10:00:00.000Z", nodes: [worker("laptop-1", 2, 0, null)] }),
      machine("studio", "holding", { holding: [{ code: "capability_expired", message: "Capability report expired", remedy: null }], nodes: [worker("studio-1", 2, 0, 2)], load: load(24, 40) }),
      machine("vm-a", "booting", { kind: "cloud" }),
    ],
    waiting: { reasons: [{ code: "no_free_slot", message: "Every slot on an eligible machine is busy", remedy: null }], agents: [] },
  };
}
const build = (v = view(), ready: number | null = 0) => buildSwarmGraph(v, { host: "aq.example:8080", ready, now: NOW });
const byId = (g: ReturnType<typeof build>, id: string) => g.nodes.find(n => n.id === id);

describe("buildSwarmGraph", () => {
  it("builds the mockup tree", () => {
    const ids = build().nodes.map(n => n.id);
    expect(ids).toEqual(expect.arrayContaining(["server", "machine:desktop", "node:local-1", "node:local-2", "machine:laptop", "free:studio-1:0"]));
    expect(ids.filter(i => i.startsWith("agent:"))).toHaveLength(4);
    // Every slot is a card: local-1's three are busy, local-2 has one free of two, studio-1 two of two.
    expect(ids.filter(i => i.startsWith("free:"))).toEqual(["free:local-2:0", "free:studio-1:0", "free:studio-1:1"]);
    expect(ids).not.toContain("node:laptop-1");
  });
  it("machine sub and meters", () => {
    const d = byId(build(), "machine:desktop")!;
    expect(d.data.sub).toBe("local · 24 cores · 4 of 5 slots busy on 2 workers");
    expect(d.data.meters).toEqual([{ label: "CPU", percent: 61 }, { label: "RAM", percent: 58 }]);
    expect(byId(build(), "machine:laptop")!.data.sub).toBe("local · offline 2h ago");
  });
  it("a hold is shown only while a node's own holding list is not empty in this response", () => {
    // The machine row says holding, with a reason; none of its nodes holds: the node was between reports.
    const between = build();
    expect(byId(between, "machine:studio")!.data).toMatchObject({ reason: null, state: "online" });
    expect(byId(between, "node:studio-1")!.data).toMatchObject({ reason: null, state: null, sub: "0 of 2 slots busy" });
    expect(byId(between, "free:studio-1:0")!.data.label).toBe("free");
    const v = view(); v.machines[2]!.nodes[0]!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: null }];
    const holding = build(v);
    expect(byId(holding, "machine:studio")!.data).toMatchObject({ reason: "holding: Capability report expired", state: "holding" });
    expect(byId(holding, "node:studio-1")!.data).toMatchObject({ reason: "holding: Capability report expired", state: "holding" });
    // Its slot is not offered as free.
    expect(byId(holding, "free:studio-1:0")!.data).toMatchObject({ label: "holding", state: "holding" });
    // A machine with several nodes names the ones that hold.
    const w = view(); w.machines[0]!.state = "holding"; w.machines[0]!.holding = [{ code: "capability_expired", message: "local-2: Capability report expired", remedy: null }];
    expect(byId(build(w), "machine:desktop")!.data).toMatchObject({ reason: null, state: "online" });
    w.machines[0]!.nodes[1]!.holding = [{ code: "capability_expired", message: "Capability report expired", remedy: null }];
    expect(byId(build(w), "machine:desktop")!.data).toMatchObject({ reason: "holding: local-2", state: "holding" });
  });
  it("offline edge dashed and not animated", () => {
    const e = build().edges.find(x => x.target === "machine:laptop")!;
    expect(e.animated).toBeFalsy();
    expect(e.style?.strokeDasharray).toBe("5 4");
    expect(build().edges.find(x => x.target === "machine:desktop")!.animated).toBe(true);
  });
  it("a busy node with no slot total is one card: its attempt, and no free card", () => {
    const v = view(); v.machines[0]!.nodes = [worker("local-1", null, 1, null, [agent(1, "claude", "fast")])];
    const g = build(v);
    expect(g.nodes.some(n => n.id.startsWith("free:local-1"))).toBe(false);
    expect(byId(g, "node:local-1")!.data.sub).toBe("1 of 1 slot busy");
    expect(g.edges.filter(e => e.source === "node:local-1").map(e => e.target)).toEqual(["agent:s1"]);
  });
  it("draws exactly as many slot cards as the node has slots: twelve free slots are twelve cards, none folded into a count", () => {
    const v = view(); v.machines[0]!.nodes = [worker("local-1", 12, 0, 12)];
    const free = build(v).nodes.filter(n => n.id.startsWith("free:local-1"));
    expect(free.map(n => [n.data.slot, n.data.label, n.data.ariaLabel])).toEqual(Array.from({ length: 12 }, (_, i) => [i + 1, "free", `Slot ${i + 1} free`]));
    // The owner sets the node to five slots: five cards.
    v.machines[0]!.nodes = [worker("local-1", 5, 0, 5)];
    expect(build(v).nodes.filter(n => n.id.startsWith("free:local-1"))).toHaveLength(5);
    expect(byId(build(v), "node:local-1")!.data.sub).toBe("0 of 5 slots busy");
  });
  it("a node with more agent rows than slots draws them all and says so", () => {
    const v = view(); v.machines[0]!.nodes = [worker("local-1", 2, 3, 0, [agent(1, "claude", "fast"), agent(2, "claude", "fast"), agent(3, "claude", "fast")])];
    const g = build(v);
    expect(g.nodes.filter(n => n.data.kind === "agent").map(n => [n.data.slot, n.data.over, n.data.ariaLabel.replace(/^.* (?=Slot \d|No slot)/, "")])).toEqual([[1, false, "Slot 1"], [2, false, "Slot 2"], [null, true, "No slot"]]);
    expect(byId(g, "node:local-1")!.data).toMatchObject({ sub: "3 of 2 slots busy", reason: "more agents than slots: 3 on 2", over: true });
    expect(byId(g, "machine:desktop")!.data.sub).toBe("local · 24 cores · 3 of 2 slots busy on 1 worker");
    // Within its slots a node is not flagged.
    expect(byId(build(), "node:local-1")!.data).toMatchObject({ sub: "3 of 3 slots busy", reason: null, over: false });
  });
  it("waiting branch only with ready work and reasons", () => {
    expect(showWaiting(view(), 0)).toBe(false);
    expect(byId(build(view(), 0), "waiting")).toBeUndefined();
    expect(byId(build(view(), 3), "waiting")!.data.sub).toBe("3 ready tasks · Every slot on an eligible machine is busy");
  });
  it("layout is top-down", () => {
    const g = build(); const placed = layoutSwarm(g.nodes, g.edges);
    const y = (id: string) => placed.find(n => n.id === id)!.position.y;
    expect(y("server")).toBeLessThan(y("machine:desktop"));
    expect(y("machine:desktop")).toBeLessThan(y("node:local-1"));
    expect(y("node:local-1")).toBeLessThan(y("agent:s1"));
    for (const n of placed) { expect(Number.isFinite(n.position.x)).toBe(true); expect(Number.isFinite(n.position.y)).toBe(true); }
  });
  it("an unknown machine state keeps its children; only offline, stopped and booting hide them", () => {
    const v = view(); v.machines[0]!.state = "unknown";
    expect(build(v).nodes.map(n => n.id)).toContain("node:local-1");
    for (const state of ["offline", "stopped", "booting"] as const) { const w = view(); w.machines[0]!.state = state; expect(build(w).nodes.map(n => n.id)).not.toContain("node:local-1"); }
  });
  it("a stale view draws no animated edge", () => {
    expect(build().edges.some(e => e.animated)).toBe(true);
    expect(buildSwarmGraph(view(), { host: "h", ready: 0, now: NOW, stale: true }).edges.some(e => e.animated)).toBe(false);
  });
  it("waiting agent pills carry the first reason and a full-text tooltip", () => {
    const v = view(); const reason = { code: "no_free_slot", message: "desktop compute-bound", remedy: null };
    v.waiting.agents = [{ taskId: "t9", title: "Fix it", project: { id: "p", label: "proj" }, provider: "claude", intelligenceClass: "standard", reasons: [reason], since: null }];
    const pill = byId(buildSwarmGraph(v, { host: "h", ready: 0, now: NOW }), "waiting-agent:t9")!;
    expect(pill.data.label).toBe("claude · standard — desktop compute-bound");
    expect(pill.data.tooltip).toBe(pill.data.label);
  });
  it("the waiting card is sized from its lines and dagre gets that height", () => {
    const one = byId(build(view(), 3), "waiting")!;
    const v = view(); v.waiting.reasons.push({ code: "no_machine_online", message: "No machine is online", remedy: null }, { code: "no_eligible_machine", message: "No machine can take work", remedy: null });
    const many = byId(build(v, 3), "waiting")!;
    expect(many.data.reason).toBe("No machine is online\nNo machine can take work");
    expect(many.data.box.height).toBeGreaterThan(one.data.box.height);
    expect(one.data.box.height).toBeGreaterThan(48);
    const g = build(v, 3); const placed = layoutSwarm(g.nodes, g.edges);
    expect(placed.find(n => n.id === "waiting")!.height).toBe(many.data.box.height);
  });
  it("an agent card leads with the task's title, then role and level, then model and effort, and carries its level's colour", () => {
    const v = view();
    const ranWith = { role: "developer", level: "standard-high", provider: "anthropic", model: "claude-sonnet-5-5", reasoning: "high", harness: "claude" };
    v.machines[0]!.nodes = [worker("local-1", 3, 2, 1, [
      { ...agent(1, "anthropic", "standard"), task: { id: "t1", title: "Write an architecture overview" }, routingProfile: { id: "standard-high", displayName: "Standard, high" }, ranWith, phase: "finishing", startedAt: NOW },
      agent(2, "anthropic", "fast"),
    ])];
    const [first, second] = buildSwarmGraph(v, { host: "h", ready: 0, now: NOW }).nodes.filter(n => n.data.kind === "agent");
    expect(first!.data.label).toBe("Write an architecture overview");
    expect(first!.data.agent).toEqual({ title: "Write an architecture overview", who: "developer · Standard, high", what: "claude-sonnet-5-5 · high effort", phase: "finishing", startedAt: NOW, level: "standard" });
    expect(first!.data.ariaLabel).toBe("Write an architecture overview developer · Standard, high Finishing claude-sonnet-5-5 · high effort Slot 1");
    expect(first!.data.tooltip).toBe("Write an architecture overview · proj · developer · Standard, high · Finishing · claude-sonnet-5-5 · high effort");
    // An older server's row: the class stands for the level, and its "fast" is the simple level.
    expect(second!.data.agent).toEqual({ title: "Task 2", who: "fast", what: "anthropic", phase: "running", startedAt: null, level: "simple" });
  });
  it("a node with eight slots and agents in slots 1 to 8 is eight cards in slot order, four across and two down", () => {
    const v = view();
    const agents = [8, 3, 1, 6, 2, 7, 5, 4].map(slot => ({ ...agent(slot, "claude", "standard"), slot }));
    v.machines = [machine("desktop", "online", { nodes: [worker("local-1", 8, 8, 0, agents)] })];
    const g = build(v), placed = layoutSwarm(g.nodes, g.edges);
    const cards = g.edges.filter(e => e.source === "node:local-1").map(e => placed.find(n => n.id === e.target)!);
    expect(cards.map(c => [c.data.slot, c.id])).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(slot => [slot, `agent:s${slot}`]));
    expect(cards[0]!.data.ariaLabel).toMatch(/^Task 1 .* Slot 1$/);
    expect(byId(g, "node:local-1")!.data.sub).toBe("8 of 8 slots busy");
    expect(byId(g, "machine:desktop")!.data.sub).toBe("local · 8 cores · 8 of 8 slots busy on 1 worker");
    // Four columns, two rows, in slot order.
    expect(new Set(cards.map(c => c.position.x)).size).toBe(4);
    expect(cards.map(c => c.position.y)).toEqual([...cards].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).map(c => c.position.y));
    expect(new Set(cards.map(c => c.position.y)).size).toBe(2);
    // Three busy of eight: the free slots keep their places.
    v.machines[0]!.nodes = [worker("local-1", 8, 3, 5, agents.filter(a => [2, 5, 8].includes(a.slot)))];
    expect(build(v).nodes.filter(n => n.data.kind === "agent" || n.data.kind === "free").map(n => [n.data.slot, n.data.kind])).toEqual([[1, "free"], [2, "agent"], [3, "free"], [4, "free"], [5, "agent"], [6, "free"], [7, "free"], [8, "agent"]]);
  });
});

describe("the tree on a screen", () => {
  // The live stack's shape: a desktop with two worker nodes of eight slots and a laptop with one of four. Seven busy.
  const slotted = (id: string, total: number, busy: number[]) => worker(id, total, busy.length, total - busy.length, busy.map(slot => ({ ...agent(Number(`${id.slice(1)}${slot}`), "claude", "standard"), slot })));
  const twenty = () => {
    const v = view();
    v.machines = [
      machine("desktop", "online", { load: load(61, 58), nodes: [slotted("d1", 8, [1, 2, 4]), slotted("d2", 8, [1, 2, 3])] }),
      machine("laptop", "online", { load: load(20, 30), nodes: [slotted("l3", 4, [1])] }),
    ];
    return v;
  };
  const overlaps = (placed: ReturnType<typeof layoutSwarm>) => {
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!, b = placed[j]!;
      if (!(a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x || a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y)) return `${a.id} overlaps ${b.id}`;
    }
    return null;
  };
  it("draws one card per slot: twenty slots on three workers are twenty cards, each in a place of one size, the free ones smaller", () => {
    const g = build(twenty()), placed = layoutSwarm(g.nodes, g.edges);
    const slots = placed.filter(n => ["agent", "free", "held"].includes(n.data.kind));
    expect(slots).toHaveLength(20);
    expect(slots.filter(n => n.data.kind === "agent")).toHaveLength(7);
    expect(slots.filter(n => n.data.kind === "free")).toHaveLength(13);
    expect(new Set(slots.filter(n => n.data.kind === "agent").map(n => `${n.data.box.width}x${n.data.box.height}`))).toEqual(new Set([`${SLOT_CELL.width}x${SLOT_CELL.height}`]));
    // A free card is smaller than a busy one and sits in the middle of the same place, so the tree keeps its shape as attempts start and finish.
    expect(CARD_SIZE.free.width * CARD_SIZE.free.height).toBeLessThan(0.4 * SLOT_CELL.width * SLOT_CELL.height);
    for (const id of ["node:d1", "node:d2", "node:l3"]) {
      const cards = g.edges.filter(e => e.source === id).map(e => placed.find(n => n.id === e.target)!);
      // Slot order, left to right then down: eight slots are four across and two down, four are two and two.
      expect(cards.map(c => c.data.slot)).toEqual(cards.map((_, i) => i + 1));
      const centres = cards.map(c => [c.position.x + c.width! / 2, c.position.y + c.height! / 2] as const);
      const across = id === "node:l3" ? 2 : 4;
      expect(new Set(centres.map(c => c[0])).size).toBe(across);
      expect(new Set(centres.map(c => c[1])).size).toBe(cards.length / across);
      centres.forEach((c, i) => { expect(c[0]).toBe(centres[i % across]![0]); expect(c[1]).toBe(centres[Math.floor(i / across) * across]![1]); });
    }
    expect(byId(g, "node:d1")!.data.sub).toBe("3 of 8 slots busy");
    expect(byId(g, "machine:desktop")!.data.sub).toBe("local · 8 cores · 6 of 16 slots busy on 2 workers");
    // An attempt starting in a free slot changes no card's place.
    const more = twenty(); more.machines[0]!.nodes[0] = slotted("d1", 8, [1, 2, 4, 7]);
    const g2 = build(more), again = layoutSwarm(g2.nodes, g2.edges);
    expect(fitBounds(again, g2.edges)).toEqual(fitBounds(placed, g.edges));
    expect(slotFrames(again, g2.edges)).toEqual(slotFrames(placed, g.edges));
    expect(again.find(n => n.id === "node:d2")!.position).toEqual(placed.find(n => n.id === "node:d2")!.position);
  });
  it.each([[1006, 368, 0.4], [1646, 693, 0.75], [1280, 540, 0.6]])("fits twenty slots on three workers whole in a %ix%i canvas", (width, height, least) => {
    const g = build(twenty());
    const { nodes: placed, columns } = layoutForCanvas(g.nodes, g.edges, { width, height });
    // The desktop's two workers are stacked: that draws the cards largest.
    expect(columns).toBe(1);
    expect(placed.find(n => n.id === "node:d2")!.position.y).toBeGreaterThan(placed.find(n => n.id === "node:d1")!.position.y);
    expect(overlaps(placed)).toBeNull();
    const viewport = fitViewport(placed, { width, height }, g.edges)!, bounds = treeBounds(placed);
    expect(viewport.zoom).toBeGreaterThan(least);
    expect(viewport.zoom).toBeLessThanOrEqual(FIT.maxZoom);
    // Every card, and every worker's frame, is inside the canvas.
    const frames = slotFrames(placed, g.edges);
    expect(frames.map(f => f.id)).toEqual(["frame:node:d1", "frame:node:d2", "frame:node:l3"]);
    const left = Math.min(bounds.x, ...frames.map(f => f.x)), top = Math.min(bounds.y, ...frames.map(f => f.y));
    const right = Math.max(bounds.x + bounds.width, ...frames.map(f => f.x + f.width)), bottom = Math.max(bounds.y + bounds.height, ...frames.map(f => f.y + f.height));
    expect(left * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
    expect(top * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
    expect(right * viewport.zoom + viewport.x).toBeLessThanOrEqual(width);
    expect(bottom * viewport.zoom + viewport.y).toBeLessThanOrEqual(height);
    // No two frames overlap, and each holds its worker and all of that worker's slot cards.
    for (const f of frames) for (const o of frames) if (f !== o) expect(f.x + f.width <= o.x || o.x + o.width <= f.x || f.y + f.height <= o.y || o.y + o.height <= f.y).toBe(true);
    for (const f of frames) for (const c of [f.id.slice(6), ...g.edges.filter(e => e.source === f.id.slice(6)).map(e => e.target)].map(id => placed.find(n => n.id === id)!)) {
      expect(c.position.x >= f.x && c.position.y >= f.y && c.position.x + c.width! <= f.x + f.width && c.position.y + c.height! <= f.y + f.height, `${c.id} in ${f.id}`).toBe(true);
    }
  });
  it("without a canvas it wraps at four; a tall narrow canvas takes more rows", () => {
    const g = build(twenty());
    expect(layoutForCanvas(g.nodes, g.edges, null).columns).toBe(4);
    expect(layoutForCanvas(g.nodes, g.edges, { width: 400, height: 1600 }).columns).toBeLessThan(4);
    expect(layoutForCanvas(g.nodes, g.edges, { width: 400, height: 1600 }, 4).columns).toBe(4);
  });
  it("a tree too large for the smallest zoom opens at that zoom with the server at the top centre", () => {
    const g = build(twenty()), placed = layoutSwarm(g.nodes, g.edges);
    const root = placed.find(n => n.id === "server")!;
    const viewport = fitViewport(placed, { width: 900, height: 30 })!;
    expect(viewport.zoom).toBe(FIT.minZoom);
    expect(viewport.x + (root.position.x + root.width! / 2) * viewport.zoom).toBeCloseTo(450);
    expect(viewport.y).toBe(24 - root.position.y * FIT.minZoom);
    // A phone-width canvas opens no smaller than half size.
    expect(fitViewport(placed, { width: 390, height: 420 })!.zoom).toBe(0.5);
    expect(fitViewport([], { width: 100, height: 100 })).toBeNull();
  });
  it("a machine's edges reach its nodes without crossing a card: lower rows through the gap beside their column; a node's slots need no lines", () => {
    // The desktop's two workers stacked, as the canvas sizes above lay them out.
    const g = build(twenty()), placed = layoutSwarm(g.nodes, g.edges, "TB", 1), routed = routeEdges(placed, g.edges);
    const card = (id: string) => placed.find(n => n.id === id)!;
    const bus = routed.filter(e => e.source === "machine:desktop");
    expect(bus.every(e => e.type === "bus")).toBe(true);
    const top = bus.filter(e => card(e.target).position.y === card("node:d1").position.y), lower = bus.filter(e => !top.includes(e));
    expect(top.map(e => e.target)).toEqual(["node:d1"]); expect(lower.map(e => e.target)).toEqual(["node:d2"]);
    for (const e of top) expect(e.data).toMatchObject({ gutter: null });
    const footprints = placed.filter(n => n.data.kind !== "server" && n.data.kind !== "machine");
    for (const e of lower) {
      const { gutter, lane, upper } = e.data as { gutter: number; lane: number; upper: number };
      // The vertical run is in no card's columns, and both lanes are between rows.
      expect(footprints.every(n => gutter <= n.position.x || gutter >= n.position.x + n.width!)).toBe(true);
      for (const y of [lane, upper]) expect(placed.every(n => y <= n.position.y || y >= n.position.y + n.height!)).toBe(true);
    }
    // A worker's frame holds its slots, so the edges from a node to its slot cards are kept for the layout and not drawn.
    const toSlots = routed.filter(e => e.source.startsWith("node:"));
    expect(toSlots).toHaveLength(20);
    expect(toSlots.every(e => e.hidden === true)).toBe(true);
    // Other edges are left as they were.
    expect(routed.find(e => e.source === "server")!.type).toBeUndefined();
    expect(routed.find(e => e.source === "server")!.hidden).toBeUndefined();
  });
});

describe("large fleets", () => {
it("shows the routing profile while retaining the legacy palette", () => {
  const v = view();
  v.machines[0]!.nodes[0]!.agents[0]!.routingProfile = { id: "complex", displayName: "Complex" };
  const card = byId(build(v), "agent:s1")!;
  expect(card.data.agent).toMatchObject({ who: "Complex", level: "complex" });
  expect(card.data.intelligenceClass).toBe("standard");
});

it.each([100, 200])("stacks %i agents per worker in two columns and reserves the complete fleet footprint", count => {
  const v = view();
  v.machines = Array.from({ length: 2 }, (_, m) => machine(`fleet-${m}`, "online", {
    nodes: Array.from({ length: 2 }, (_, w) => worker(`fleet-${m}-${w}`, count + 3, count, 3,
      Array.from({ length: count }, (_, a) => agent(m * count * 2 + w * count + a, "codex", "fast")))),
  }));
  v.waiting.agents = Array.from({ length: count }, (_, i) => ({ taskId: `waiting-${i}`, title: "Waiting task", project: { id: "p", label: "proj" }, provider: "codex", intelligenceClass: "fast" as const, reasons: [], since: null }));
  const graph = build(v), placed = layoutSwarm(graph.nodes, graph.edges);
  expect(placed.map(n => n.id)).toEqual(graph.nodes.map(n => n.id));
  expect(new Set(placed.map(n => n.id)).size).toBe(placed.length);
  for (const parent of placed.filter(n => n.data.kind === "node" || n.data.kind === "waiting")) {
    const childIds = new Set(graph.edges.filter(e => e.source === parent.id).map(e => e.target));
    const children = placed.filter(n => childIds.has(n.id));
    expect(children.filter(n => n.data.kind === "free")).toHaveLength(parent.data.kind === "waiting" ? 0 : 3);
    // Free cards share the agent cards' columns.
    expect(new Set(children.map(n => n.position.x + n.width! / 2)).size).toBe(2);
    expect(new Set(children.map(n => n.position.y)).size).toBe(Math.ceil(children.length / 2));
    expect(Math.max(...children.map(n => n.position.x + n.width!)) - Math.min(...children.map(n => n.position.x))).toBeLessThanOrEqual(parent.data.kind === "waiting" ? 474 : 542);
    for (const child of children) {
      expect(child.position.y).toBeGreaterThan(parent.position.y + parent.height!);
      expect(graph.edges.find(e => e.source === parent.id && e.target === child.id)).toBeDefined();
    }
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i]!, b = placed[j]!;
    expect(a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x || a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y, `${a.id} overlaps ${b.id}`).toBe(true);
  }
});

it("top-aligns heterogeneous branches without letting a long waiting queue push workers down", () => {
  const v = view();
  v.machines = [machine("large", "online", { nodes: [
    worker("large-worker", 200, 200, 0, Array.from({ length: 200 }, (_, i) => agent(i, "codex", "fast"))),
    worker("small-sibling", 1, 1, 0, [agent(200, "codex", "fast")]),
  ] }), machine("small", "online", { nodes: [worker("small-worker", 1, 1, 0, [agent(201, "codex", "fast")])] })];
  v.waiting.agents = Array.from({ length: 200 }, (_, i) => ({ taskId: `waiting-${i}`, title: "Waiting task", project: { id: "p", label: "proj" }, provider: "codex", intelligenceClass: "fast" as const, reasons: [], since: null }));
  const graph = build(v), placed = layoutSwarm(graph.nodes, graph.edges);
  const card = (id: string) => placed.find(n => n.id === id)!;
  for (const edge of graph.edges) {
    const parent = card(edge.source), child = card(edge.target);
    if (["agent", "free", "waitingAgent"].includes(child.data.kind)) continue;
    expect(child.position.y).toBe(parent.position.y + parent.height! + RANK_GAP);
  }
  expect(card("node:large-worker").position.y).toBe(card("node:small-sibling").position.y);
  expect(card("node:large-worker").position.y).toBe(card("node:small-worker").position.y);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i]!, b = placed[j]!;
    expect(a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x || a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y, `${a.id} overlaps ${b.id}`).toBe(true);
  }
});
});
