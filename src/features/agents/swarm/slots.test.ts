import { describe, expect, it } from "vitest";
import { adaptSwarm, type AgentView, type MachineView, type NodeView } from "../../../api/adapters/swarm";
import { demoSwarm } from "../../../mocks/swarm";
import { buildSwarmGraph } from "./graph";
import { mergeManual, type ManualFleet } from "./manualAgents";
import { agentState, clock, heldCount, holdingNodes, levelKey, levelLabel, machineShare, nodeSlots, outputActivity, phaseParts, shownMachineState, slotCapacity, taskLabel, titleMissing, workerCounts, workerHeadline, workerTile } from "./slots";

const NOW = "2026-11-17T12:00:00.000Z";
const agent = (n: number, extra: Partial<AgentView> = {}): AgentView => ({
  sessionId: `s${n}`, attemptId: `a${n}`, task: { id: `t${n}`, title: `Task ${n}` }, project: { id: "p", label: "proj" },
  provider: "anthropic", model: "claude-sonnet-5", harness: "claude-code", intelligenceClass: "standard", terminalId: null, startedAt: NOW, ...extra,
});
const worker = (total: number | null, occupied: number, agents: AgentView[]): NodeView => ({
  id: "w1", name: "Local Worker 1", health: "online", service: "running", serviceSince: null, backendKind: "docker-local", workerVersion: "0.1.0", sandboxTemplates: [],
  agentChannel: "unreported", lastSeenAt: NOW, slots: { total, occupied, idle: total === null ? null : total - occupied, held: Math.max(0, occupied - agents.length) }, holding: [], agents,
});

describe("a slot an attempt holds", () => {
  it("is held and never free", () => {
    // Granted but not started: the server counts the slot and lists no agent for it.
    expect(heldCount(worker(4, 2, [agent(1)]))).toBe(1);
  });
  it("is drawn as a held card in the tree and counted on the machine's edge", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const graph = buildSwarmGraph(view, { host: "aq", ready: 0, now: NOW });
    const held = graph.nodes.filter(n => n.data.kind === "held");
    expect(held.map(n => n.data.label)).toEqual(["slot held", "slot held"]);
    expect(graph.nodes.filter(n => n.data.kind === "agent")).toHaveLength(5);
  });
  it("animates the edge of a machine whose only work is still starting", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    view.machines[1]!.nodes[0]!.agents = []; view.machines[1]!.nodes[0]!.slots = { total: 4, occupied: 1, idle: 3, held: 1 };
    const graph = buildSwarmGraph(view, { host: "aq", ready: 0, now: NOW });
    expect(graph.edges.find(e => e.target === "machine:laptop")!.animated).toBe(true);
  });
  it("stays occupied when the interactive fleet's capacity replaces the server's", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const node = view.machines[1]!.nodes[0]!;
    node.agents = []; node.slots = { total: 4, occupied: 2, idle: 2, held: 2 };
    const project = "20000000-0000-4000-8000-000000009001", repo = "20000000-0000-4000-8000-000000009002";
    const fleet: ManualFleet = { launch_profiles: [], sessions: [], workers: [{ node_id: node.id, max_slots: 4, repositories: [repo], providers: ["anthropic"], observed_at_ms: Date.parse(NOW) }],
      slots: [{ node_id: node.id, project_id: project, slots: 4, revision: 1 }], projects: [{ id: project, name: "Fixture", repository_id: repo }], server_time_ms: Date.parse(NOW) };
    const merged = mergeManual(view, fleet, null, null).machines[1]!.nodes[0]!;
    expect(merged.slots).toMatchObject({ total: 4, occupied: 2, idle: 2, held: 2 });
  });
  it("is not counted twice when an older count is below the agents listed", () => {
    expect(heldCount(worker(2, 0, [agent(1)]))).toBe(0);
  });
});

describe("phases", () => {
  it("an agent row without a phase is running: today's server lists a row only while its agent runs", () => {
    expect(agentState(agent(1))).toBe("running");
  });
  it("uses the server's phase when it sends one", () => {
    expect([agent(1, { phase: "starting", startedAt: null }), agent(2), agent(3, { phase: "finishing" })].map(agentState)).toEqual(["starting", "running", "finishing"]);
  });
});

const machineOf = (nodes: NodeView[], extra: Partial<MachineView> = {}): MachineView => ({
  id: "m", label: "Machine", kind: "local", state: "online", holding: [], lastSeenAt: NOW, load: null, hardware: null, agentMax: null, cost: null, control: null, controlUnrecognised: false, nodes, ...extra,
});
const viewOf = (machines: MachineView[]) => ({ ...adaptSwarm(demoSwarm(NOW), NOW), machines });

describe("a node's real slots", () => {
  it("is one slot while the total is the interactive-session cap: an unmarked total of 8, 4 or none draws one card", () => {
    for (const total of [8, 4, null]) {
      const idle = worker(total, 0, []), busy = worker(total, 1, [agent(1)]);
      expect(slotCapacity(idle)).toBe(1);
      expect(nodeSlots(machineOf([idle]), idle)).toEqual([{ kind: "free", index: 0, slot: null, standing: null }]);
      expect(nodeSlots(machineOf([busy]), busy)).toEqual([{ kind: "agent", agent: busy.agents[0], slot: null }]);
    }
    // An attempt the read does not name still takes the slot: held, never free.
    const held = worker(null, 1, []);
    expect(nodeSlots(machineOf([held]), held)).toEqual([{ kind: "held", index: 0, slot: null }]);
  });
  it("the adapter believes a total only when the server marks it or numbers its agents' slots", () => {
    const wire = demoSwarm(NOW, true);
    const view = adaptSwarm(wire, NOW);
    expect(view.machines.flatMap(m => m.nodes).every(n => n.capacity === undefined)).toBe(true);
    const marked = structuredClone(wire), node = marked.machines[0]!.nodes[0]!;
    node.slots = { total: 8, occupied: 1, idle: 7, basis: "attempts" };
    expect(adaptSwarm(marked, NOW).machines[0]!.nodes[0]!.capacity).toBe(8);
    const numbered = structuredClone(wire), other = numbered.machines[0]!.nodes[0]!;
    other.slots = { total: 8, occupied: 1, idle: 7 }; other.agents[0]!.slot = 3;
    const adapted = adaptSwarm(numbered, NOW).machines[0]!.nodes[0]!;
    expect(adapted.capacity).toBe(8);
    expect(adapted.agents[0]!.slot).toBe(3);
    // A slot index that is not a positive whole number is not an index.
    const bad = structuredClone(wire); bad.machines[0]!.nodes[0]!.agents[0]!.slot = 0;
    expect(adaptSwarm(bad, NOW).machines[0]!.nodes[0]!.capacity).toBeUndefined();
  });
  it("the shape to come: a node with a real total of eight and agents in slots 1 to 8 is eight cards in slot order", () => {
    const agents = [5, 2, 8, 1].map(slot => agent(slot, { slot, phase: slot === 8 ? "starting" : "running" }));
    const node: NodeView = { ...worker(8, 5, agents), capacity: 8 };
    const cards = nodeSlots(machineOf([node]), node);
    expect(cards.map(c => [c.slot, c.kind, c.kind === "agent" ? c.agent.sessionId : null])).toEqual([
      [1, "agent", "s1"], [2, "agent", "s2"], [3, "held", null], [4, "free", null], [5, "agent", "s5"], [6, "free", null], [7, "free", null], [8, "agent", "s8"],
    ]);
    const c = workerCounts(viewOf([machineOf([node])]));
    expect(workerHeadline(c)).toBe("5 of 8 slots busy on 1 worker");
    expect(phaseParts(c)).toEqual(["1 starting", "3 running", "1 starting or settling"]);
    expect(c.machines.map(machineShare)).toEqual(["Machine: 5 of 8 slots busy"]);
    // All eight in order, with no other change.
    const full: NodeView = { ...worker(8, 8, [8, 7, 6, 5, 4, 3, 2, 1].map(slot => agent(slot, { slot }))), capacity: 8 };
    expect(nodeSlots(machineOf([full]), full).map(c => c.kind === "agent" && c.agent.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(workerHeadline(workerCounts(viewOf([machineOf([full])])))).toBe("8 of 8 slots busy on 1 worker");
  });
  it("a node that takes no work offers no free slot: its card says what it is doing instead", () => {
    const holding: NodeView = { ...worker(8, 0, []), holding: [{ code: "capability_expired", message: "Capability report expired", remedy: null }] };
    expect(nodeSlots(machineOf([holding]), holding)).toEqual([{ kind: "free", index: 0, slot: null, standing: "holding" }]);
    const offline: NodeView = { ...worker(null, 1, [agent(1)]), health: "offline" };
    // The attempt the read still lists is drawn; the slot is not counted busy while the node is not there.
    expect(nodeSlots(machineOf([offline]), offline).map(c => c.kind)).toEqual(["agent"]);
    expect(workerHeadline(workerCounts(viewOf([machineOf([offline])])))).toBe("0 of 1 slot busy");
  });
});

describe("a machine's hold", () => {
  const hold = { code: "capability_expired", message: "Local Worker 2: Capability report expired", remedy: null };
  it("is its nodes' own: a machine row that says holding while no node holds in this response is not holding", () => {
    const between = machineOf([worker(8, 0, []), worker(null, 1, [agent(1)])], { state: "holding", holding: [hold] });
    expect(holdingNodes(between)).toEqual([]);
    expect(shownMachineState(between)).toBe("online");
    expect(workerCounts(viewOf([between])).machines.map(machineShare)).toEqual(["Machine: 1 of 2 slots busy"]);
    const holding = machineOf([{ ...worker(8, 0, []), holding: [{ ...hold, message: "Capability report expired" }] }, worker(null, 1, [agent(1)])], { state: "holding", holding: [hold] });
    expect(holdingNodes(holding)).toHaveLength(1);
    expect(shownMachineState(holding)).toBe("holding");
    expect(workerCounts(viewOf([holding])).machines.map(machineShare)).toEqual(["Machine: 1 of 2 slots busy · holding"]);
  });
});

describe("an agent's level", () => {
  it("is the first word of the level it ran at, else an older server's class", () => {
    expect(levelKey(agent(1, { routingProfile: { id: "standard-high", displayName: "Standard, high" } }))).toBe("standard");
    expect(levelKey(agent(1, { routingProfile: { id: "complex", displayName: "Complex" }, intelligenceClass: "deep" }))).toBe("complex");
    expect(levelKey(agent(1, { routingProfile: null, ranWith: { role: "writer", level: "simple-high", provider: "anthropic", model: "m", reasoning: "high", harness: "claude" } }))).toBe("simple");
    expect(levelKey(agent(1, { routingProfile: { id: "x1", displayName: "Deep, low" } }))).toBe("deep");
    expect(levelKey(agent(1, { intelligenceClass: "fast" }))).toBe("simple");
    expect(levelKey(agent(1, { intelligenceClass: null }))).toBeNull();
  });
});

describe("workers on the board", () => {
  const machine = (nodes: NodeView[], extra: Partial<MachineView> = {}): MachineView => ({
    id: "m", label: "Machine", kind: "local", state: "online", holding: [], lastSeenAt: NOW, load: null, hardware: null, agentMax: null, cost: null, control: null, controlUnrecognised: false, nodes, ...extra,
  });
  const tile = (n: NodeView, extra: Partial<MachineView> = {}) => workerTile(machine([n], extra), n);
  it("is busy with the attempt it holds, idle with none, and never counts interactive slots", () => {
    expect(tile(worker(8, 1, [agent(1)]))).toMatchObject({ state: "busy", phase: "running", others: [], heldMore: 0 });
    expect(tile(worker(8, 0, []))).toMatchObject({ state: "idle", phase: null, agent: null });
    expect(tile(worker(null, 1, [agent(1, { phase: "finishing" })]))).toMatchObject({ state: "busy", phase: "finishing" });
    // An attempt the read does not name still holds the worker.
    expect(tile(worker(null, 1, []))).toMatchObject({ state: "busy", phase: "held", agent: null, heldMore: 0 });
  });
  it("shows the queued attempt before an interactive one, a running one before the rest, then the latest start", () => {
    const manual = agent(1, { manual: { status: "running" } as NonNullable<AgentView["manual"]>, startedAt: "2026-11-17T12:05:00.000Z" });
    const stale = agent(2, { startedAt: "2026-11-17T11:00:00.000Z" }), latest = agent(3, { startedAt: "2026-11-17T12:01:00.000Z" }), starting = agent(4, { phase: "starting", startedAt: null });
    const t = tile(worker(8, 5, [manual, stale, starting, latest]));
    expect(t.agent).toBe(latest);
    expect(t.others).toEqual([manual, stale, starting]);
    expect(t.heldMore).toBe(1);
    expect(tile(worker(8, 1, [manual])).agent).toBe(manual);
  });
  it("says why a worker that takes no work is not idle, and keeps a busy worker's attempt", () => {
    const hold = { code: "capability_expired", message: "Capability report expired", remedy: "Wait" };
    expect(tile({ ...worker(4, 0, []), holding: [hold] })).toMatchObject({ state: "holding", reason: "Capability report expired" });
    expect(tile({ ...worker(4, 0, []), service: "draining" })).toMatchObject({ state: "draining" });
    expect(tile(worker(4, 0, []), { control: { desired: "draining", generation: "1", since: null, pendingHandoffs: 0 } })).toMatchObject({ state: "draining" });
    expect(tile({ ...worker(4, 0, []), health: "offline" })).toMatchObject({ state: "offline" });
    expect(tile({ ...worker(4, 0, []), service: "stopped" })).toMatchObject({ state: "stopped" });
    expect(tile({ ...worker(4, 0, []), health: "revoked" })).toMatchObject({ state: "revoked" });
    expect(tile({ ...worker(4, 1, [agent(1)]), service: "draining" })).toMatchObject({ state: "busy", standing: "draining" });
    // A machine that is gone holds nothing now; what the read still lists is kept, not shown as running.
    const gone = tile(worker(4, 1, [agent(1)]), { state: "offline" });
    expect(gone).toMatchObject({ state: "offline", agent: null, phase: null });
    expect(gone.others).toHaveLength(1);
  });
  it("counts the demo as the live stack reads: seven of nine slots busy on two workers, by phase and by model", () => {
    const c = workerCounts(adaptSwarm(demoSwarm(NOW, true), NOW));
    expect(workerHeadline(c)).toBe("7 of 9 slots busy on 2 workers");
    expect(phaseParts(c)).toEqual(["1 starting", "5 running", "1 finishing"]);
    expect(c.machines.map(m => [m.label, m.busy, m.workers])).toEqual([["Fixture desktop", 6, 8], ["Fixture laptop", 1, 1]]);
    expect(c.models.map(m => `${m.model} ×${m.count}`)).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
  });
  it("the demo is the live shape: nine workers, one attempt each at most, slot totals of 8, 4 or none", () => {
    const nodes = demoSwarm(NOW, true).machines.flatMap(m => m.nodes);
    expect(nodes.map(n => n.name)).toEqual(["Local Worker 1", "Local Worker 1#3", "Local Worker 1#4", "Local Worker 1#5", "Local Worker 1#6", "Local Worker 1#7", "Local Worker 1#8", "Local Worker 2", "Local Worker 3"]);
    expect(nodes.map(n => n.slots.total)).toEqual([8, null, null, null, null, null, null, 8, 4]);
    expect(nodes.every(n => n.agents.length <= 1 && n.slots.occupied === n.agents.length)).toBe(true);
    expect(nodes.find(n => n.name === "Local Worker 1#3")!.slots).toEqual({ total: null, occupied: 1, idle: null });
  });
  it("says one slot on one worker, and no worker when nothing is busy", () => {
    const one = { serverTime: NOW, server: { version: "", sourceRevision: "", runningAgents: null, ownerAvailability: null }, waiting: { reasons: [], agents: [] } };
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(8, 1, [agent(1)])])] }))).toBe("1 of 1 slot busy on 1 worker");
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(8, 0, [])])] }))).toBe("0 of 1 slot busy");
    expect(workerHeadline(workerCounts({ ...one, machines: [] }))).toBe("No slots");
  });
});

describe("what a tile says", () => {
  it("runs a clock from the start time", () => {
    expect(clock("2026-11-17T12:00:07.900Z", NOW)).toBe("0:07");
    expect(clock("2026-11-17T12:12:34.000Z", NOW)).toBe("12:34");
    expect(clock("2026-11-17T13:02:03.000Z", NOW)).toBe("1:02:03");
    expect(clock("2026-11-17T11:59:00.000Z", NOW)).toBe("0:00");
    expect(clock(NOW, null)).toBeNull();
    expect(clock(null, NOW)).toBeNull();
  });
  it("reports output only when the read carries its time", () => {
    expect(outputActivity("2026-11-17T12:00:05.000Z", NOW)).toEqual({ state: "active", ageMs: 5_000 });
    expect(outputActivity("2026-11-17T12:01:00.000Z", NOW)?.state).toBe("quiet");
    expect(outputActivity(NOW, undefined)).toBeNull();
    expect(outputActivity(NOW, null)).toBeNull();
  });
  it("does not show the task's id as its title", () => {
    const id = "10000000-0000-4000-8000-000000000005";
    expect(titleMissing({ id, title: id })).toBe(true);
    expect(titleMissing({ id, title: "" })).toBe(true);
    expect(titleMissing({ id, title: "Fix it" })).toBe(false);
    expect(taskLabel(agent(1, { task: { id, title: id } }))).toBe("Task 10000000");
    expect(taskLabel(agent(1, { task: { id, title: "Fix it" } }))).toBe("Fix it");
    expect(taskLabel(agent(1, { task: null }))).toBe("No task");
  });
  it("names the level from the routing profile, then ran_with, then an older server's class", () => {
    expect(levelLabel(agent(1, { routingProfile: { id: "standard-high", displayName: "Standard, high" } }))).toBe("Standard, high");
    expect(levelLabel(agent(1, { routingProfile: null, ranWith: { role: "developer", level: "deep", provider: "a", model: "m", reasoning: "high", harness: "h" } }))).toBe("deep");
    expect(levelLabel(agent(1, { routingProfile: null }))).toBeNull();
    expect(levelLabel(agent(1))).toBe("standard");
  });
});
