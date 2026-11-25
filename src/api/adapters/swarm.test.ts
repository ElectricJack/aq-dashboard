import { describe, expect, it } from "vitest";
import { adaptSwarm } from "./swarm";
import type { Swarm } from "../wire/swarm";
import pinned from "../../../contracts/pinned/dashboard-read/v1/fixtures/swarm.json";

const hold = { code: "capability_expired", message: "Capability report expired", remedy: "Wait for the next report; restart the worker if none arrives" } as const;
function fixture(): Swarm {
  return {
    server: { version: "0.1.0", source_revision: "85070006aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", running_agents: 1 },
    machines: [{
      id: "desktop", label: "desktop", kind: "local", state: "online", holding: [], last_seen_at: "2026-11-07T10:00:00.000Z",
      load: { source: "windows_host", host_probe: "fresh", cpu_busy_bps: 6149, memory_used_bps: 5800, cpu_avg_15m_bps: 5500, memory_avg_15m_bps: 5600, samples_15m: 60, observed_at: "2026-11-07T10:00:00.000Z", fresh: true },
      hardware: { logical_cpus: 24, memory_total_bytes: 2 ** 36, disk_total_bytes: 2e12, disk_free_bytes: 294e9 }, agent_max: 5, cost: null,
      nodes: [{
        node: { id: "5d4cad0e-5f6c-4821-9ebf-b12de2c7dc0f", type: "worker" }, name: "local-1", health: "online", service: { state: "unreported", since: null },
        backend_kind: "docker-local", worker_version: "0.1.0", sandbox_templates: [], agent_channel: "unreported", last_seen_at: "2026-11-07T10:00:00.000Z",
        slots: { total: 3, occupied: 1, idle: 2 }, holding: [hold],
        agents: [{ session_id: "10000000-0000-4000-8000-000000000003", attempt_id: "10000000-0000-4000-8000-000000000004", task: { id: "10000000-0000-4000-8000-000000000005", title: "Do it" },
          project: { id: "10000000-0000-4000-8000-000000000006", label: "proj" }, provider: "claude", model: "claude-sonnet-5", harness: "claude-code", intelligence_class: "standard",
          terminal: { id: "10000000-0000-4000-8000-000000000001", type: "terminal" }, started_at: null }],
      }],
    }],
    waiting: { reasons: [], agents: [] },
  };
}
const TIME = "2026-11-07T10:00:05.000Z";

describe("slots an attempt holds and the facts a newer server adds", () => {
  it("counts a slot the server reports occupied with no agent listed as held", () => {
    const f = fixture(); f.machines[0]!.nodes[0]!.slots = { total: 3, occupied: 3, idle: 0 };
    expect(adaptSwarm(f, TIME).machines[0]!.nodes[0]!.slots).toEqual({ total: 3, occupied: 3, idle: 0, held: 2 });
    expect(adaptSwarm(fixture(), TIME).machines[0]!.nodes[0]!.slots.held).toBe(0);
  });
  it("leaves phase, ran_with and output time absent on today's rows", () => {
    const a = adaptSwarm(fixture(), TIME).machines[0]!.nodes[0]!.agents[0]!;
    expect("phase" in a || "ranWith" in a || "lastOutputAt" in a).toBe(false);
    const pinnedAgent = adaptSwarm((pinned as unknown as { data: Swarm }).data, TIME).machines.flatMap(m => m.nodes).flatMap(n => n.agents)[0]!;
    expect("phase" in pinnedAgent || "ranWith" in pinnedAgent || "lastOutputAt" in pinnedAgent).toBe(false);
  });
  it("reads them when the server sends them", () => {
    const f = fixture();
    Object.assign(f.machines[0]!.nodes[0]!.agents[0]!, { phase: "starting", last_output_at: "2026-11-07T10:00:03.000Z",
      ran_with: { role: "developer", level: "standard-high", provider: "anthropic", model: "claude-sonnet-5", reasoning: "high", harness: "claude-code", execution_profile: "sandbox", snapshot_digest: null } });
    expect(adaptSwarm(f, TIME).machines[0]!.nodes[0]!.agents[0]).toMatchObject({ phase: "starting", lastOutputAt: "2026-11-07T10:00:03.000Z",
      ranWith: { role: "developer", level: "standard-high", provider: "anthropic", model: "claude-sonnet-5", reasoning: "high", harness: "claude-code" } });
  });
  it("reads capability reporting diagnostics and drops an incomplete rejection", () => {
    const f = fixture();
    Object.assign(f.machines[0]!.nodes[0]!, { capability_observed_at: "2026-11-07T09:59:00.000Z",
      inventory_rejection: { request_id: "10000000-0000-4000-8000-000000000009", observed_at_ms: 1_762_509_600_000, stage: "verify_presence_qualification", status: 409, code: "conflict" } });
    expect(adaptSwarm(f, TIME).machines[0]!.nodes[0]).toMatchObject({ capabilityObservedAt: "2026-11-07T09:59:00.000Z",
      inventoryRejection: { requestId: "10000000-0000-4000-8000-000000000009", observedAt: "2025-11-07T10:00:00.000Z", stage: "verify_presence_qualification", status: 409, code: "conflict" } });
    Object.assign(f.machines[0]!.nodes[0]!, { inventory_rejection: { request_id: "x", stage: "validate", status: 409 } });
    expect(adaptSwarm(f, TIME).machines[0]!.nodes[0]!.inventoryRejection).toBeNull();
    expect(adaptSwarm(fixture(), TIME).machines[0]!.nodes[0]).toMatchObject({ capabilityObservedAt: null, inventoryRejection: null });
  });
  it("reads the 09ee5e98 shape and the same read with fields it does not know (held-since times, a real title)", () => {
    const today = adaptSwarm((pinned as unknown as { data: Swarm }).data, TIME);
    const f = fixture();
    const row = f.machines[0]!.nodes[0]!.agents[0]! as unknown as Record<string, unknown>;
    Object.assign(row, { phase: "finishing", held_since: "2026-11-07T09:59:00.000Z", phase_since: "2026-11-07T10:00:01.000Z", last_output_at: null, ran_with: null, task: { id: "10000000-0000-4000-8000-000000000005", title: "A real title" } });
    Object.assign(f.machines[0]!.nodes[0]!.slots, { held_since: ["2026-11-07T09:59:00.000Z"] });
    Object.assign(f.machines[0]!, { held_since: "2026-11-07T09:59:00.000Z" });
    const next = adaptSwarm(f, TIME).machines[0]!.nodes[0]!;
    expect(next.agents[0]).toMatchObject({ phase: "finishing", task: { title: "A real title" }, ranWith: null, lastOutputAt: null });
    expect(next.slots).toEqual({ total: 3, occupied: 1, idle: 2, held: 0 });
    expect(today.machines.length).toBeGreaterThan(0);
  });
  it("drops a phase it does not know and a ran_with with a part missing", () => {
    const f = fixture();
    Object.assign(f.machines[0]!.nodes[0]!.agents[0]!, { phase: "paused", ran_with: { role: "developer", level: "", model: "m" }, last_output_at: null });
    const a = adaptSwarm(f, TIME).machines[0]!.nodes[0]!.agents[0]!;
    expect(a.phase).toBeUndefined();
    expect(a.ranWith).toBeNull();
    expect(a.lastOutputAt).toBeNull();
  });
});

describe("adaptSwarm", () => {
  it("pinned swarm fixture adapts", () => {
    const f = pinned as unknown as { data: Swarm; server_time: string };
    const v = adaptSwarm(f.data, f.server_time);
    expect(v.machines[0]!.label).toBe("desktop");
    expect(v.machines[0]!.load?.source).toBe("windows_host");
    const agent = v.machines.flatMap(m => m.nodes).flatMap(n => n.agents)[0]!;
    expect(agent.terminalId === null || typeof agent.terminalId === "string").toBe(true);
    expect(v.server.runningAgents).toBeGreaterThanOrEqual(1);
  });
  it("adapts a complete read", () => {
    const v = adaptSwarm(fixture(), TIME);
    expect(v.machines[0]!.label).toBe("desktop");
    expect(v.machines[0]!.load?.source).toBe("windows_host");
    expect(v.machines[0]!.nodes[0]!.agents[0]!.terminalId).toBe("10000000-0000-4000-8000-000000000001");
    expect(v.machines[0]!.nodes[0]!.holding[0]!.remedy).toBe("Wait for the next report; restart the worker if none arrives");
    expect(v.server.runningAgents).toBeGreaterThanOrEqual(1);
  });
  it("unknown enum values degrade, never throw", () => {
    const f = fixture() as unknown as { machines: Record<string, unknown>[] };
    f.machines[0]!.state = "sleeping";
    ((f.machines[0]!.nodes as Record<string, unknown>[])[0]!.agents as Record<string, unknown>[])[0]!.intelligence_class = "genius";
    ((f.machines[0]!.nodes as Record<string, unknown>[])[0]!.service as Record<string, unknown>).state = "hibernating";
    const v = adaptSwarm(f as unknown as Swarm, TIME);
    expect(v.machines[0]!.state).toBe("unknown");
    expect(v.machines[0]!.nodes[0]!.agents[0]!.intelligenceClass).toBeNull();
    expect(v.machines[0]!.nodes[0]!.service).toBe("unreported");
  });
  it("unknown fields are ignored", () => {
    const f = fixture() as unknown as { machines: Record<string, unknown>[] };
    f.machines[0]!.future = 1;
    expect(() => adaptSwarm(f as unknown as Swarm, TIME)).not.toThrow();
  });
  it("bps become whole percents", () => {
    expect(adaptSwarm(fixture(), TIME).machines[0]!.load?.cpuPercent).toBe(61);
    const f = fixture(); f.machines[0]!.load!.cpu_busy_bps = 6150;
    expect(adaptSwarm(f, TIME).machines[0]!.load?.cpuPercent).toBe(62);
  });
  it("missing machines array is a contract error", () => {
    expect(() => adaptSwarm({ server: fixture().server, waiting: { reasons: [], agents: [] } } as unknown as Swarm, TIME)).toThrow(/Contract violation/);
  });
  it("unknown kind, load source and missing counts stay unknown, never 0", () => {
    const f = fixture() as unknown as { server: Record<string, unknown>; machines: Record<string, unknown>[] };
    f.machines[0]!.kind = "spaceship";
    (f.machines[0]!.load as Record<string, unknown>).source = "bsd";
    delete (f.machines[0]!.hardware as Record<string, unknown>).logical_cpus;
    delete f.server.running_agents;
    const v = adaptSwarm(f as unknown as Swarm, TIME);
    expect(v.machines[0]!.kind).toBe("unknown");
    expect(v.machines[0]!.load?.source).toBe("unknown");
    expect(v.machines[0]!.hardware?.logicalCpus).toBeNull();
    expect(v.server.runningAgents).toBeNull();
  });
  it("null 15-minute averages (no samples) stay null, never 0", () => {
    const f = fixture(); const load = f.machines[0]!.load!;
    load.cpu_avg_15m_bps = null; load.memory_avg_15m_bps = null; load.samples_15m = 0;
    const v = adaptSwarm(f, TIME).machines[0]!.load!;
    expect(v.cpuAvgPercent).toBeNull(); expect(v.memoryAvgPercent).toBeNull();
    expect(v.cpuPercent).toBe(61);
  });
  it("adapts machine control", () => {
    const f = fixture(); f.machines[0]!.control = { desired: "stopped", generation: "2", since: "2026-11-07T10:00:00.000Z", pending_handoffs: 1 };
    expect(adaptSwarm(f, TIME).machines[0]!.control).toEqual({ desired: "stopped", generation: "2", since: "2026-11-07T10:00:00.000Z", pendingHandoffs: 1 });
  });
  it("unknown desired state gives no control", () => {
    const f = fixture() as unknown as { machines: Record<string, unknown>[] };
    f.machines[0]!.control = { desired: "paused", generation: "1", since: null, pending_handoffs: 0 };
    expect(adaptSwarm(f as unknown as Swarm, TIME).machines[0]!.control).toBeNull();
    f.machines[0]!.control = { desired: "running", generation: "0", since: null, pending_handoffs: 0 };
    expect(adaptSwarm(f as unknown as Swarm, TIME).machines[0]!.control).toBeNull();
    f.machines[0]!.control = { desired: "running", generation: "1", since: null };
    expect(adaptSwarm(f as unknown as Swarm, TIME).machines[0]!.control?.pendingHandoffs).toBe(0);
  });
  it("missing control is null (older server)", () => {
    expect(adaptSwarm(fixture(), TIME).machines[0]!.control).toBeNull();
  });
  it("adapts owner availability", () => {
    const f = fixture(); f.server.owner_availability = { state: "on", generation: "2", since: "2026-11-07T09:00:00.000Z" };
    expect(adaptSwarm(f, TIME).server.ownerAvailability).toEqual({ state: "on", generation: "2", since: "2026-11-07T09:00:00.000Z", note: null });
    expect(adaptSwarm(fixture(), TIME).server.ownerAvailability).toBeNull();
  });
  it("keeps the former-owner note on an unset switch", () => {
    const f = fixture(); f.server.owner_availability = { state: "unset", generation: "5", since: null, note: "Set by a former owner; reads as unset." };
    expect(adaptSwarm(f, TIME).server.ownerAvailability).toEqual({ state: "unset", generation: "5", since: null, note: "Set by a former owner; reads as unset." });
  });
  it("unknown availability state is null", () => {
    const f = fixture() as unknown as { server: Record<string, unknown> };
    f.server.owner_availability = { state: "maybe", generation: "2", since: null };
    expect(adaptSwarm(f as unknown as Swarm, TIME).server.ownerAvailability).toBeNull();
  });
});

it("adapts the authoritative routing profile while preserving the legacy palette", () => {
  const f = fixture();
  const a = f.machines[0]!.nodes[0]!.agents[0]!;
  a.routing_profile = { id: "complex", display_name: "Complex" };
  const adapted = adaptSwarm(f, TIME).machines[0]!.nodes[0]!.agents[0]!;
  expect(adapted.routingProfile).toEqual({ id: "complex", displayName: "Complex" });
  expect(adapted.intelligenceClass).toBe("standard");
  (a as unknown as Record<string, unknown>).routing_profile = { id: "complex" };
  expect(adaptSwarm(f, TIME).machines[0]!.nodes[0]!.agents[0]!.routingProfile).toBeNull();
});
