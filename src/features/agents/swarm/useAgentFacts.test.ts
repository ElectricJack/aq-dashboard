import { describe, expect, it } from "vitest";
import { adaptSwarm } from "../../../api/adapters/swarm";
import { DEMO_PROJECTS, demoSwarm } from "../../../mocks/swarm";
import { applyFacts, factTargets, ranWithOf } from "./useAgentFacts";

const NOW = "2026-11-17T12:00:00.000Z";
const agents = (v: ReturnType<typeof adaptSwarm>) => v.machines.flatMap(m => m.nodes).flatMap(n => n.agents);
const RAN_WITH = { role: "reviewer", level: "deep", provider: "anthropic", model: "claude-opus-5-5", reasoning: "high", harness: "claude-code" };

describe("facts the swarm read does not carry", () => {
  it("asks for the title and ran_with of every agent whose row lacks them", () => {
    const t = factTargets(adaptSwarm(demoSwarm(NOW), NOW));
    expect(t.titles).toHaveLength(5);
    expect(t.ranWith).toHaveLength(5);
  });
  it("asks for nothing once the server sends them", () => {
    expect(factTargets(adaptSwarm(demoSwarm(NOW, true), NOW))).toEqual({ titles: [], ranWith: [] });
    expect(factTargets(undefined)).toEqual({ titles: [], ranWith: [] });
  });
  it("skips ids the Graph reads would refuse", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    agents(view)[0]!.project.id = "not-a-uuid";
    expect(factTargets(view).titles).toHaveLength(4);
  });
  it("fills the title and ran_with it was given and leaves the other rows as they were", () => {
    const view = adaptSwarm(demoSwarm(NOW), NOW);
    const [first, second] = agents(view);
    const filled = applyFacts(view, { titles: new Map([[first!.task!.id, "Add retry backoff"]]), ranWith: new Map([[first!.attemptId, RAN_WITH]]) });
    expect(agents(filled)[0]).toMatchObject({ task: { id: first!.task!.id, title: "Add retry backoff" }, ranWith: RAN_WITH });
    expect(agents(filled)[1]).toBe(second);
    expect(applyFacts(view, { titles: new Map(), ranWith: new Map() })).toBe(view);
  });
  it("never replaces a title the server gave", () => {
    const view = adaptSwarm(demoSwarm(NOW, true), NOW);
    const first = agents(view)[0]!;
    expect(agents(applyFacts(view, { titles: new Map([[first.task!.id, "Other"]]), ranWith: new Map() }))[0]!.task!.title).toBe(first.task!.title);
  });
});

describe("ran_with from the task's work read", () => {
  const project = DEMO_PROJECTS[0]!.id, attempt = "20000000-0000-4000-8000-000000007200";
  const work = (execution: unknown) => ({ contract: "human-graph-1", project: { id: project, name: "Fixture", revision: "1", workspace_id: "20000000-0000-4000-8000-000000007000" }, observed_at: NOW, data: { execution } });
  it("is taken when the holding attempt is the one the swarm row names", () => {
    expect(ranWithOf(work({ attempt_id: attempt, ran_with: { ...RAN_WITH, execution_profile: "sandbox", snapshot_digest: "d".repeat(64) } }), project, attempt)).toEqual(RAN_WITH);
  });
  it("accepts an attempt from before roles, whose snapshot digest is null", () => {
    expect(ranWithOf(work({ attempt_id: attempt, ran_with: { ...RAN_WITH, execution_profile: "sandbox", snapshot_digest: null } }), project, attempt)).toEqual(RAN_WITH);
  });
  it("is not taken from another attempt, a missing record or no holding attempt", () => {
    expect(ranWithOf(work({ attempt_id: "20000000-0000-4000-8000-000000007299", ran_with: RAN_WITH }), project, attempt)).toBeNull();
    expect(ranWithOf(work({ attempt_id: attempt }), project, attempt)).toBeNull();
    expect(ranWithOf(work(null), project, attempt)).toBeNull();
  });
});
