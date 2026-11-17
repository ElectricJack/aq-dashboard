import { describe, expect, it } from "vitest";
import { adaptSwarm, type AgentView, type MachineView, type NodeView } from "../../../api/adapters/swarm";
import { demoSwarm, SWARM_MOCKUP } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { buildSwarmGraph } from "./graph";
import { mergeManual, type ManualFleet } from "./manualAgents";
import { agentState, clock, detailParts, headline, heldCount, levelLabel, outputActivity, phaseParts, swarmCounts, taskLabel, titleMissing, workerCounts, workerHeadline, workerTile } from "./slots";

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

describe("counts", () => {
  it("the tree's slot counts on the demo: five running on the desktop, two held, and no slot total while a worker reports none", () => {
    const c = swarmCounts(adaptSwarm(demoSwarm(NOW), NOW));
    expect(headline(c)).toBe("5 agents running on 1 machine");
    expect(detailParts(c)).toEqual(["2 starting or settling", "17 free"]);
    expect(c.machines.map(m => [m.label, m.running, m.held, m.free, m.total])).toEqual([["Fixture desktop", 5, 1, 14, null], ["Fixture laptop", 0, 1, 3, 4]]);
  });
  it("names starting and finishing agents once the server lists them", () => {
    const c = swarmCounts(adaptSwarm(demoSwarm(NOW, true), NOW));
    expect(headline(c)).toBe("5 agents running on 1 machine");
    expect(detailParts(c)).toEqual(["1 starting", "1 finishing", "17 free"]);
  });
  it("leaves an offline, stopped or booting machine's slots out and says one agent on one machine", () => {
    const view = adaptSwarm(SWARM_MOCKUP, SERVER_TIME);
    const c = swarmCounts(view);
    expect(headline(c)).toBe("4 agents running on 1 machine");
    // desktop 5 slots (1 free) and studio 2 (2 free); the offline laptop's 2 are not offered as free.
    expect(detailParts(c)).toEqual(["3 free of 7 slots"]);
    expect(c.machines.find(m => m.id === "laptop")).toMatchObject({ live: false, state: "offline", free: 0, total: null });
    view.machines = view.machines.filter(m => m.id === "laptop");
    expect(headline(swarmCounts(view))).toBe("No agents running");
  });
  it("says nothing runs yet while slots are only held", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    for (const m of view.machines) for (const n of m.nodes) { n.slots = { ...n.slots, held: n.slots.occupied }; n.agents = []; }
    expect(headline(swarmCounts(view))).toBe("No agents running yet");
  });
  it("gives no slot total when a worker reports none", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    view.machines[0]!.nodes[0]!.slots = { total: null, occupied: 5, idle: null, held: 0 };
    // Seven free on Local Worker 2 and three on the laptop; no "of N slots".
    expect(detailParts(swarmCounts(view)).at(-1)).toBe("10 free");
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
