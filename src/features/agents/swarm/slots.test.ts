import { describe, expect, it } from "vitest";
import { adaptSwarm, type AgentView, type NodeView } from "../../../api/adapters/swarm";
import { demoSwarm, SWARM_MOCKUP } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { buildSwarmGraph } from "./graph";
import { mergeManual, type ManualFleet } from "./manualAgents";
import { agentState, clock, detailParts, headline, levelLabel, nodeSlots, outputActivity, swarmCounts, taskLabel, titleMissing } from "./slots";

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
  it("is held, between the agents and the free slots, and never free", () => {
    // Granted but not started: the server counts the slot and lists no agent for it.
    const slots = nodeSlots(worker(4, 2, [agent(1)]));
    expect(slots.map(s => s.state)).toEqual(["running", "held", "free", "free"]);
    expect(slots.map(s => s.key)).toEqual(["agent:s1", "held:w1:0", "free:w1:0", "free:w1:1"]);
  });
  it("is drawn as a held card in the tree and counted on the machine's edge", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const graph = buildSwarmGraph(view, { host: "aq", ready: 0, now: NOW });
    const held = graph.nodes.filter(n => n.data.kind === "held");
    expect(held.map(n => n.data.label)).toEqual(["slot held", "slot held"]);
    expect(graph.nodes.filter(n => n.data.kind === "free")).toHaveLength(6);
    expect(graph.nodes.filter(n => n.data.kind === "agent")).toHaveLength(12);
    // Twenty slots: every one is an agent, held or free.
    expect(graph.nodes.filter(n => ["agent", "held", "free"].includes(n.data.kind))).toHaveLength(20);
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
    expect(nodeSlots(merged).map(s => s.state)).toEqual(["held", "held", "free", "free"]);
  });
  it("is not counted twice when an older count is below the agents listed", () => {
    expect(nodeSlots(worker(2, 0, [agent(1)])).filter(s => s.state === "held")).toHaveLength(0);
  });
});

describe("phases", () => {
  it("an agent row without a phase is running: today's server lists a row only while its agent runs", () => {
    expect(agentState(agent(1))).toBe("running");
  });
  it("uses the server's phase when it sends one", () => {
    expect(nodeSlots(worker(4, 3, [agent(1, { phase: "starting", startedAt: null }), agent(2), agent(3, { phase: "finishing" })])).map(s => s.state)).toEqual(["starting", "running", "finishing", "free"]);
  });
});

describe("counts", () => {
  it("counts the demo: twelve running on two machines, two held, six free of twenty", () => {
    const c = swarmCounts(adaptSwarm(demoSwarm(NOW), NOW));
    expect(headline(c)).toBe("12 agents running on 2 machines");
    expect(detailParts(c)).toEqual(["2 starting or settling", "6 free of 20 slots"]);
    expect(c.machines.map(m => [m.label, m.running, m.held, m.free, m.total])).toEqual([["Fixture desktop", 9, 2, 5, 16], ["Fixture laptop", 3, 0, 1, 4]]);
  });
  it("names starting and finishing agents once the server lists them", () => {
    const c = swarmCounts(adaptSwarm(demoSwarm(NOW, true), NOW));
    expect(headline(c)).toBe("12 agents running on 2 machines");
    expect(detailParts(c)).toEqual(["1 starting", "1 finishing", "6 free of 20 slots"]);
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
    expect(detailParts(swarmCounts(view)).at(-1)).toBe("4 free");
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
