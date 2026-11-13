import { describe, expect, it } from "vitest";
import type { AgentView, MachineView, NodeView, SwarmView } from "../../../api/adapters/swarm";
import { buildSwarmGraph, layoutSwarm, showWaiting } from "./graph";

const NOW = "2026-11-07T12:00:00.000Z";
const agent = (n: number, provider: string, cls: AgentView["intelligenceClass"]): AgentView => ({
  sessionId: `s${n}`, attemptId: `a${n}`, task: { id: `t${n}`, title: `Task ${n}` }, project: { id: "p", label: "proj" },
  provider, model: null, harness: null, intelligenceClass: cls, terminalId: `term${n}`, startedAt: null,
});
const worker = (id: string, total: number | null, occupied: number, idle: number | null, agents: AgentView[] = []): NodeView => ({
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
      machine("studio", "holding", { holding: [{ code: "measurement_expired", message: "Context measurement expired", remedy: null }], nodes: [worker("studio-1", 2, 0, 2)], load: load(24, 40) }),
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
    expect(ids).toEqual(expect.arrayContaining(["server", "machine:desktop", "node:local-1", "machine:laptop", "free:local-2:0"]));
    expect(ids.filter(i => i.startsWith("agent:"))).toHaveLength(4);
    expect(ids).not.toContain("node:laptop-1");
  });
  it("machine sub and meters", () => {
    const d = byId(build(), "machine:desktop")!;
    expect(d.data.sub).toBe("local · 24 cores · max 5 agents");
    expect(d.data.meters).toEqual([{ label: "CPU", percent: 61 }, { label: "RAM", percent: 58 }]);
    expect(byId(build(), "machine:laptop")!.data.sub).toBe("local · offline 2h ago");
  });
  it("holding reason line", () => {
    expect(byId(build(), "machine:studio")!.data.reason).toBe("holding: Context measurement expired");
  });
  it("offline edge dashed and not animated", () => {
    const e = build().edges.find(x => x.target === "machine:laptop")!;
    expect(e.animated).toBeFalsy();
    expect(e.style?.strokeDasharray).toBe("5 4");
    expect(build().edges.find(x => x.target === "machine:desktop")!.animated).toBe(true);
  });
  it("unknown slot total draws no free pills", () => {
    const v = view(); v.machines[0]!.nodes = [worker("local-1", null, 1, null, [agent(1, "claude", "fast")])];
    const g = build(v);
    expect(g.nodes.some(n => n.id.startsWith("free:local-1"))).toBe(false);
    expect(byId(g, "node:local-1")!.data.sub!.endsWith("capacity not reported")).toBe(true);
  });
  it("free pill overflow", () => {
    const v = view(); v.machines[0]!.nodes = [worker("local-1", 12, 0, 12)];
    const pills = build(v).nodes.filter(n => n.id.startsWith("free:local-1"));
    expect(pills).toHaveLength(8);
    expect(pills.at(-1)!.data.label).toBe("+5 free");
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
  it("labels an agent pill with its harness, falling back to the provider", () => {
    const v = view();
    v.machines[0]!.nodes = [worker("local-1", 3, 2, 1, [{ ...agent(1, "anthropic", "standard"), harness: "claude" }, agent(2, "anthropic", "fast")])];
    const labels = buildSwarmGraph(v, { host: "h", ready: 0, now: NOW }).nodes.filter(n => n.data.kind === "agent").map(n => n.data.label);
    expect(labels).toEqual(["claude · standard", "anthropic · fast"]);
  });
});

it("shows the routing profile while retaining the legacy palette", () => {
  const v = view();
  v.machines[0]!.nodes[0]!.agents[0]!.routingProfile = { id: "complex", displayName: "Complex" };
  const card = byId(build(v), "agent:s1")!;
  expect(card.data.label).toBe("claude · Complex");
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
    // Free pills share the same column centres as the wider agent pills.
    expect(new Set(children.map(n => n.position.x + n.width! / 2)).size).toBe(2);
    expect(new Set(children.map(n => n.position.y)).size).toBe(Math.ceil(children.length / 2));
    expect(Math.max(...children.map(n => n.position.x + n.width!)) - Math.min(...children.map(n => n.position.x))).toBeLessThanOrEqual(parent.data.kind === "waiting" ? 474 : 274);
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
    expect(child.position.y).toBe(parent.position.y + parent.height! + 46);
  }
  expect(card("node:large-worker").position.y).toBe(card("node:small-sibling").position.y);
  expect(card("node:large-worker").position.y).toBe(card("node:small-worker").position.y);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i]!, b = placed[j]!;
    expect(a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x || a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y, `${a.id} overlaps ${b.id}`).toBe(true);
  }
});
