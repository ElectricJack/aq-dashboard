import { http, HttpResponse } from "msw";
import type { Swarm, HoldReason, SwarmAgent, SwarmNode } from "../api/wire/swarm";
import { SERVER_TIME, SESSIONS } from "./inspectionData";
import { fixtureTerminalId } from "./terminal";

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (ms: number) => new Date(Date.parse(SERVER_TIME) - ms).toISOString();
const reason = (code: HoldReason["code"], message: string, remedy: string): HoldReason => ({ code, message, remedy });

export const NO_MACHINE_ONLINE = reason("no_machine_online", "No machine is online", "Start a worker on any machine");
const NO_FREE_SLOT = reason("no_free_slot", "Every slot on an eligible machine is busy", "Wait for a running agent to finish, or add a machine");
const MEASUREMENT_EXPIRED = reason("measurement_expired", "Context measurement expired", "Measure this worker's runtime again");

function agent(i: number, provider: string, model: string, harness: string, cls: SwarmAgent["intelligence_class"]): SwarmAgent {
  const s = SESSIONS[i]!;
  return {
    session_id: s.id, attempt_id: uuid(500 + i), task: { id: s.task!.id, title: s.task!.title }, project: { id: s.project.id, label: s.project.label },
    provider, model, harness, intelligence_class: cls, terminal: { id: fixtureTerminalId(i), type: "terminal" }, started_at: ago(12 * 60_000),
  };
}
function worker(n: number, name: string, backend: string, total: number | null, agents: SwarmAgent[], extra: Partial<SwarmNode> = {}): SwarmNode {
  return {
    node: { id: uuid(n), type: "worker" }, name, health: "online", service: { state: "unreported", since: null }, backend_kind: backend,
    worker_version: "0.1.0", sandbox_templates: [`sha256:${String(n).repeat(64).slice(0, 64)}`], agent_channel: "unreported", last_seen_at: ago(4_000),
    slots: { total, occupied: agents.length, idle: total === null ? null : total - agents.length }, holding: [], agents, ...extra,
  };
}

// Labelled fixture reproducing swarm-tree-v3.html; not real infrastructure.
export const SWARM_MOCKUP: Swarm = {
  server: { version: "0.1.0", source_revision: "85070006aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", running_agents: 4 },
  machines: [
    {
      id: "desktop", label: "desktop", kind: "local", state: "online", holding: [], last_seen_at: ago(4_000),
      load: { source: "windows_host", host_probe: "fresh", cpu_busy_bps: 6100, memory_used_bps: 5800, cpu_avg_15m_bps: 5500, memory_avg_15m_bps: 5600, samples_15m: 60, observed_at: ago(5_000), fresh: true },
      hardware: { logical_cpus: 24, memory_total_bytes: 64 * 2 ** 30, disk_total_bytes: 2e12, disk_free_bytes: 294e9 }, agent_max: 5, cost: null,
      nodes: [
        worker(1, "local-1", "docker-local", 3, [agent(0, "claude", "claude-sonnet-5", "claude", "standard"), agent(1, "claude", "claude-opus-5-5", "claude", "deep"), agent(2, "codex", "gpt-5.3-codex", "codex", "fast")]),
        worker(2, "local-2", "docker-local", 2, [agent(3, "claude", "claude-haiku-5", "claude", "fast")]),
      ],
    },
    {
      id: "laptop", label: "laptop", kind: "local", state: "offline", holding: [], last_seen_at: ago(2 * 3_600_000), load: null, hardware: null, agent_max: null, cost: null,
      nodes: [worker(3, "laptop-1", "docker-local", 2, [], { health: "offline", last_seen_at: ago(2 * 3_600_000) })],
    },
    {
      id: "studio", label: "studio", kind: "local", state: "holding", holding: [MEASUREMENT_EXPIRED], last_seen_at: ago(6_000),
      load: { source: "linux", host_probe: "not_applicable", cpu_busy_bps: 2350, memory_used_bps: 4000, cpu_avg_15m_bps: 2000, memory_avg_15m_bps: 3900, samples_15m: 58, observed_at: ago(6_000), fresh: true },
      hardware: { logical_cpus: 8, memory_total_bytes: 32 * 2 ** 30, disk_total_bytes: 1e12, disk_free_bytes: 600e9 }, agent_max: 2, cost: null,
      nodes: [worker(4, "studio-1", "docker-local", 2, [], { holding: [MEASUREMENT_EXPIRED] })],
    },
    {
      id: "boat:vm-a", label: "boat vm-a", kind: "cloud", state: "booting", holding: [], last_seen_at: null, load: null, hardware: null, agent_max: null,
      cost: { currency: "USD", micros_per_hour: 210_000, started_at: SERVER_TIME }, nodes: [],
    },
  ],
  waiting: {
    reasons: [NO_FREE_SLOT],
    agents: [
      { task: { id: uuid(901), title: "Fix flaky host-cancel test" }, project: { id: SESSIONS[0]!.project.id, label: SESSIONS[0]!.project.label }, provider: "claude", intelligence_class: "deep", reasons: [NO_FREE_SLOT], since: ago(3 * 60_000) },
      { task: { id: uuid(902), title: "Bump sandbox image" }, project: { id: SESSIONS[0]!.project.id, label: SESSIONS[0]!.project.label }, provider: "codex", intelligence_class: "fast", reasons: [NO_FREE_SLOT], since: ago(2 * 60_000) },
    ],
  },
};

export function swarmEnvelope<T>(data: T) {
  return {
    api_version: "proposed-0", request_id: "mock", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, data,
    observation: { observed_at: SERVER_TIME, fresh_until: "2026-10-31T12:00:30.000Z", source: "mock", quality: "reported", coverage: "complete" },
    pending_operations: [], coverage: { state: "complete" },
  };
}

export function swarmHandlers(reads: "ok" | "partial" | "empty" | "failed") {
  return [
    http.get("/api/v1/swarm", () => {
      if (reads === "failed") return HttpResponse.json({ request_id: "mock", code: "read_model_unavailable", message: "The read model is temporarily unavailable.", retryable: true }, { status: 503 });
      if (reads === "empty") return HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines: [], waiting: { reasons: [NO_MACHINE_ONLINE], agents: [] } }));
      return HttpResponse.json(swarmEnvelope(SWARM_MOCKUP));
    }),
  ];
}
