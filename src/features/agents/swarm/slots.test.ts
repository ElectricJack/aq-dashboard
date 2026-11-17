import { describe, expect, it } from "vitest";
import { adaptSwarm, type AgentView, type MachineView, type NodeView } from "../../../api/adapters/swarm";
import { demoSwarm } from "../../../mocks/swarm";
import { buildSwarmGraph } from "./graph";
import { mergeManual, type ManualFleet } from "./manualAgents";
import { agentState, clock, heldCount, holdingNodes, levelKey, levelLabel, machineShare, nodeBusy, nodeSlots, nodeStanding, outputActivity, overSlots, phaseParts, shownMachineState, slotCapacity, slotColumns, taskLabel, titleMissing, workerCounts, workerHeadline } from "./slots";

const NOW = "2026-11-17T12:00:00.000Z";
const agent = (n: number, extra: Partial<AgentView> = {}): AgentView => ({
  sessionId: `s${n}`, attemptId: `a${n}`, task: { id: `t${n}`, title: `Task ${n}` }, project: { id: "p", label: "proj" },
  provider: "anthropic", model: "claude-sonnet-5", harness: "claude-code", intelligenceClass: "standard", terminalId: null, startedAt: NOW, ...extra,
});
/** A node as the adapter gives it: `capacity` is the slot count the server reports, absent when it reports none. */
const worker = (total: number | null, occupied: number, agents: AgentView[]): NodeView => ({
  ...(total === null ? {} : { capacity: total }),
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

describe("a node's slots", () => {
  it("has the slots the server reports, and one when it reports none (an old worker)", () => {
    const eight = worker(8, 0, []);
    expect(slotCapacity(eight)).toBe(8);
    expect(nodeSlots(machineOf([eight]), eight)).toEqual(Array.from({ length: 8 }, (_, i) => ({ kind: "free", index: i, slot: i + 1, standing: null })));
    const old = worker(null, 0, []), busy = worker(null, 1, [agent(1)]);
    expect(slotCapacity(old)).toBe(1);
    expect(nodeSlots(machineOf([old]), old)).toEqual([{ kind: "free", index: 0, slot: 1, standing: null }]);
    expect(nodeSlots(machineOf([busy]), busy)).toEqual([{ kind: "agent", agent: busy.agents[0], slot: 1 }]);
    // An attempt the read does not name still takes the slot: held, never free.
    const held = worker(null, 1, []);
    expect(nodeSlots(machineOf([held]), held)).toEqual([{ kind: "held", index: 0, slot: 1 }]);
  });
  it("the adapter takes slots.total as the node's slot count, with no marker, and reads each row's slot", () => {
    const wire = demoSwarm(NOW, true);
    const first = (w: typeof wire) => adaptSwarm(w, NOW).machines[0]!.nodes[0]!;
    expect(adaptSwarm(wire, NOW).machines.flatMap(m => m.nodes).map(n => n.capacity)).toEqual([8, 8, 4]);
    expect(first(wire).agents.map(a => a.slot)).toEqual([1, 2, 4]);
    // The owner changes the node's Setting: the next read's total is the node's slots.
    const changed = structuredClone(wire); changed.machines[0]!.nodes[0]!.slots = { total: 6, occupied: 3, idle: 3 };
    expect(first(changed).capacity).toBe(6);
    expect(nodeSlots(adaptSwarm(changed, NOW).machines[0]!, first(changed))).toHaveLength(6);
    // An old worker reports none; a total that is not a whole number from zero is not a count.
    for (const total of [null, -1, 2.5]) {
      const old = structuredClone(wire); old.machines[0]!.nodes[0]!.slots = { total, occupied: 3, idle: null };
      expect(first(old).capacity).toBeUndefined();
    }
    // A slot index that is not a positive whole number is not an index; the node's count stands.
    const bad = structuredClone(wire); bad.machines[0]!.nodes[0]!.agents[0]!.slot = 0;
    expect(first(bad).agents[0]!.slot).toBeUndefined();
    expect(first(bad).capacity).toBe(8);
  });
  it("rows that name no slot fill the lowest free positions; a row beyond the slots is drawn, and flagged", () => {
    // Slot 2 is named twice and slot 9 is out of range: those rows take the lowest free positions, as a row with no slot does.
    const rows = [agent(1, { slot: 2 }), agent(2), agent(3, { slot: 2 }), agent(4, { slot: 9 })];
    const node = worker(4, 4, rows), m = machineOf([node]);
    expect(nodeSlots(m, node).map(c => [c.slot, c.kind === "agent" ? c.agent.sessionId : c.kind])).toEqual([[1, "s2"], [2, "s1"], [3, "s3"], [4, "s4"]]);
    expect(overSlots(m, node)).toBe(0);
    const over = worker(4, 6, [...rows, agent(5)]), om = machineOf([over]);
    expect(nodeSlots(om, over).map(c => [c.slot, c.kind === "agent" ? c.agent.sessionId : c.kind])).toEqual([[1, "s2"], [2, "s1"], [3, "s3"], [4, "s4"], [null, "s5"], [null, "held"]]);
    expect(nodeBusy(om, over)).toBe(6);
    expect(overSlots(om, over)).toBe(2);
    expect(workerHeadline(workerCounts(viewOf([om])))).toBe("6 of 4 slots busy on 1 worker");
  });
  it("lays a worker's slots out compactly: two across up to four, four across up to sixteen, then the spec's two-column stack", () => {
    expect([0, 1, 2, 4, 5, 8, 16, 17, 200].map(slotColumns)).toEqual([0, 1, 2, 2, 4, 4, 4, 2, 2]);
  });
  it("a node with eight slots and agents in slots 1 to 8 is eight cards in slot order", () => {
    const agents = [5, 2, 8, 1].map(slot => agent(slot, { slot, phase: slot === 8 ? "starting" : "running" }));
    const node: NodeView = worker(8, 5, agents);
    const cards = nodeSlots(machineOf([node]), node);
    expect(cards.map(c => [c.slot, c.kind, c.kind === "agent" ? c.agent.sessionId : null])).toEqual([
      [1, "agent", "s1"], [2, "agent", "s2"], [3, "held", null], [4, "free", null], [5, "agent", "s5"], [6, "free", null], [7, "free", null], [8, "agent", "s8"],
    ]);
    const c = workerCounts(viewOf([machineOf([node])]));
    expect(workerHeadline(c)).toBe("5 of 8 slots busy on 1 worker");
    expect(phaseParts(c)).toEqual(["1 starting", "3 running", "1 starting or settling"]);
    expect(c.machines.map(machineShare)).toEqual(["Machine: 5 of 8 slots busy"]);
    // All eight in order, with no other change.
    const full: NodeView = worker(8, 8, [8, 7, 6, 5, 4, 3, 2, 1].map(slot => agent(slot, { slot })));
    expect(nodeSlots(machineOf([full]), full).map(c => c.kind === "agent" && c.agent.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(workerHeadline(workerCounts(viewOf([machineOf([full])])))).toBe("8 of 8 slots busy on 1 worker");
  });
  it("a node that takes no work offers no free slot: its card says what it is doing instead", () => {
    const holding: NodeView = { ...worker(8, 0, []), holding: [{ code: "capability_expired", message: "Capability report expired", remedy: null }] };
    expect(nodeSlots(machineOf([holding]), holding)).toEqual(Array.from({ length: 8 }, (_, i) => ({ kind: "free", index: i, slot: i + 1, standing: "holding" })));
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
    expect(workerCounts(viewOf([between])).machines.map(machineShare)).toEqual(["Machine: 1 of 9 slots busy"]);
    const holding = machineOf([{ ...worker(8, 0, []), holding: [{ ...hold, message: "Capability report expired" }] }, worker(null, 1, [agent(1)])], { state: "holding", holding: [hold] });
    expect(holdingNodes(holding)).toHaveLength(1);
    expect(shownMachineState(holding)).toBe("holding");
    expect(workerCounts(viewOf([holding])).machines.map(machineShare)).toEqual(["Machine: 1 of 9 slots busy · holding"]);
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

describe("workers and their slots", () => {
  const machine = (nodes: NodeView[], extra: Partial<MachineView> = {}): MachineView => ({
    id: "m", label: "Machine", kind: "local", state: "online", holding: [], lastSeenAt: NOW, load: null, hardware: null, agentMax: null, cost: null, control: null, controlUnrecognised: false, nodes, ...extra,
  });
  const busy = (n: NodeView, extra: Partial<MachineView> = {}) => nodeBusy(machine([n], extra), n);
  const why = (n: NodeView, extra: Partial<MachineView> = {}) => nodeStanding(machine([n], extra), n);
  it("a node's busy slots are the attempts it holds: its agents in any phase, and attempts the read does not name", () => {
    expect(busy(worker(8, 1, [agent(1)]))).toBe(1);
    expect(busy(worker(8, 0, []))).toBe(0);
    expect(busy(worker(8, 3, [agent(1, { phase: "finishing" }), agent(2, { phase: "starting", startedAt: null })]))).toBe(3);
    // An attempt the read does not name still holds a slot.
    expect(busy(worker(null, 1, []))).toBe(1);
  });
  it("a hand-started agent takes a slot like any other; one that stopped takes none and is drawn after the slots", () => {
    const manual = agent(1, { manual: { status: "running" } as NonNullable<AgentView["manual"]> });
    const stopped = agent(2, { manual: { status: "stopped" } as NonNullable<AgentView["manual"]> });
    const queued = agent(3, { slot: 1 });
    const node = worker(4, 2, [manual, stopped, queued]), m = machine([node]);
    expect(nodeSlots(m, node).map(c => [c.slot, c.kind === "agent" ? c.agent.sessionId : c.kind])).toEqual([[1, "s3"], [2, "s1"], [3, "free"], [4, "free"], [null, "s2"]]);
    expect(nodeBusy(m, node)).toBe(2);
    expect(overSlots(m, node)).toBe(0);
  });
  it("says why a worker that takes no work is not simply free, and keeps a busy worker's attempts", () => {
    const hold = { code: "capability_expired", message: "Capability report expired", remedy: "Wait" };
    expect(why({ ...worker(4, 0, []), holding: [hold] })).toEqual({ standing: "holding", reason: "Capability report expired" });
    expect(why({ ...worker(4, 0, []), service: "draining" })).toMatchObject({ standing: "draining" });
    expect(why(worker(4, 0, []), { control: { desired: "draining", generation: "1", since: null, pendingHandoffs: 0 } })).toMatchObject({ standing: "draining" });
    expect(why({ ...worker(4, 0, []), health: "offline" })).toMatchObject({ standing: "offline" });
    expect(why({ ...worker(4, 0, []), service: "stopped" })).toMatchObject({ standing: "stopped" });
    expect(why({ ...worker(4, 0, []), health: "revoked" })).toMatchObject({ standing: "revoked" });
    expect(why(worker(4, 0, []))).toEqual({ standing: null, reason: null });
    // A draining worker still holds what it runs.
    expect(busy({ ...worker(4, 1, [agent(1)]), service: "draining" })).toBe(1);
    // A machine that is gone holds nothing now; what the read still lists is kept in its slot, not counted as busy.
    const gone = worker(4, 1, [agent(1)]);
    expect(busy(gone, { state: "offline" })).toBe(0);
    expect(nodeSlots(machine([gone], { state: "offline" }), gone).map(c => c.kind)).toEqual(["agent", "free", "free", "free"]);
  });
  it("counts the demo as the live stack reads: seven of twenty slots busy on three workers, by phase and by model", () => {
    const c = workerCounts(adaptSwarm(demoSwarm(NOW, true), NOW));
    expect(workerHeadline(c)).toBe("7 of 20 slots busy on 3 workers");
    expect(phaseParts(c)).toEqual(["1 starting", "5 running", "1 finishing"]);
    expect(c.machines.map(m => [m.label, m.busy, m.slots, m.workersBusy, m.workers])).toEqual([["Fixture desktop", 6, 16, 2, 2], ["Fixture laptop", 1, 4, 1, 1]]);
    expect(c.machines.map(machineShare)).toEqual(["Fixture desktop: 6 of 16 slots busy", "Fixture laptop: 1 of 4 slots busy"]);
    expect(c.models.map(m => `${m.model} ×${m.count}`)).toEqual(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
  });
  it("the demo is the live shape: two desktop workers of eight slots and a laptop worker of four, every row in a slot of its node", () => {
    const machines = demoSwarm(NOW, true).machines, nodes = machines.flatMap(m => m.nodes);
    expect(machines.map(m => m.nodes.map(n => n.name))).toEqual([["Local Worker 1", "Local Worker 2"], ["Local Worker 3"]]);
    expect(nodes.map(n => n.slots)).toEqual([{ total: 8, occupied: 3, idle: 5 }, { total: 8, occupied: 3, idle: 5 }, { total: 4, occupied: 1, idle: 3 }]);
    expect(nodes.map(n => n.agents.map(a => a.slot))).toEqual([[1, 2, 4], [1, 2, 3], [1]]);
    expect(nodes.every(n => !("basis" in n.slots))).toBe(true);
    // An older server's rows on the same nodes: a row only while its agent runs; the count still says what holds a slot.
    const older = demoSwarm(NOW).machines.flatMap(m => m.nodes);
    expect(older.map(n => [n.slots.occupied, n.agents.length])).toEqual([[3, 3], [3, 2], [1, 0]]);
  });
  it("a worker is a worker node: it counts toward the headline while one of its slots is busy", () => {
    const one = { serverTime: NOW, server: { version: "", sourceRevision: "", runningAgents: null, ownerAvailability: null }, waiting: { reasons: [], agents: [] } };
    const second = { ...worker(8, 2, [agent(2), agent(3)]), id: "w2" }, idle = { ...worker(4, 0, []), id: "w3" };
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(8, 1, [agent(1)]), second, idle])] }))).toBe("3 of 20 slots busy on 2 workers");
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(8, 1, [agent(1)])])] }))).toBe("1 of 8 slots busy on 1 worker");
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(null, 1, [agent(1)])])] }))).toBe("1 of 1 slot busy on 1 worker");
    expect(workerHeadline(workerCounts({ ...one, machines: [machine([worker(8, 0, [])])] }))).toBe("0 of 8 slots busy");
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
