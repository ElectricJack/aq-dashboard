import { describe, expect, it } from "vitest";
import { adaptSwarm } from "./swarm";
import type { Swarm } from "../wire/swarm";
import pinned from "../../../contracts/pinned/dashboard-read/v1/fixtures/swarm.json";

const hold = { code: "measurement_expired", message: "Context measurement expired", remedy: "Measure this worker's runtime again" } as const;
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
    expect(v.machines[0]!.nodes[0]!.holding[0]!.remedy).toBe("Measure this worker's runtime again");
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
});
