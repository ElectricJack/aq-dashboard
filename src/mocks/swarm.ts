import { http, HttpResponse } from "msw";
import type { Swarm, OwnerAvailability, HoldReason, SwarmAgent, SwarmNode } from "../api/wire/swarm";
import { SERVER_TIME, SESSIONS } from "./inspectionData";
import { fixtureTerminalId } from "./terminal";

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (ms: number) => new Date(Date.parse(SERVER_TIME) - ms).toISOString();
const reason = (code: HoldReason["code"], message: string, remedy: string): HoldReason => ({ code, message, remedy });

export const NO_MACHINE_ONLINE = reason("no_machine_online", "No machine is online", "Start a worker on any machine");
const NO_FREE_SLOT = reason("no_free_slot", "Every slot on an eligible machine is busy", "Wait for a running agent to finish, or add a machine");
const CAPABILITY_EXPIRED = reason("capability_expired", "Capability report expired", "Wait for the next report; restart the worker if none arrives");

function agent(i: number, provider: string, model: string, harness: string, cls: SwarmAgent["intelligence_class"]): SwarmAgent {
  const s = SESSIONS[i]!;
  return {
    session_id: s.id, attempt_id: uuid(500 + i), task: { id: s.task!.id, title: s.task!.title }, project: { id: s.project.id, label: s.project.label },
    provider, model, harness, intelligence_class: cls, terminal: { id: fixtureTerminalId(i), type: "terminal" }, started_at: ago(12 * 60_000),
  };
}
/** A worker node as the server lists it: `total` is its one slot count, and each agent row carries its slot, from one. */
function worker(n: number, name: string, backend: string, total: number | null, rows: SwarmAgent[], extra: Partial<SwarmNode> = {}): SwarmNode {
  const agents = rows.map((row, i): SwarmAgent => ({ slot: i + 1, ...row }));
  return {
    node: { id: uuid(n), type: "worker" }, name, health: "online", service: { state: "unreported", since: null }, backend_kind: backend,
    worker_version: "0.1.0", sandbox_templates: [`sha256:${String(n).repeat(64).slice(0, 64)}`], agent_channel: "unreported", last_seen_at: ago(4_000),
    slots: { total, occupied: agents.length, idle: total === null ? null : total - agents.length }, holding: [], agents, ...extra,
  };
}

// Labelled fixture reproducing swarm-tree-v3.html; not real infrastructure.
export const SWARM_MOCKUP: Swarm = {
  server: { version: "0.1.0", source_revision: "85070006aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", running_agents: 4, owner_availability: { state: "on", generation: "2", since: ago(3_600_000) } },
  machines: [
    {
      id: "desktop", label: "desktop", kind: "local", state: "online", holding: [], last_seen_at: ago(4_000),
      load: { source: "windows_host", host_probe: "fresh", cpu_busy_bps: 6100, memory_used_bps: 5800, cpu_avg_15m_bps: 5500, memory_avg_15m_bps: 5600, samples_15m: 60, observed_at: ago(5_000), fresh: true },
      hardware: { logical_cpus: 24, memory_total_bytes: 64 * 2 ** 30, disk_total_bytes: 2e12, disk_free_bytes: 294e9 }, agent_max: 5, cost: null,
      control: { desired: "running", generation: "1", since: null, pending_handoffs: 0 },
      nodes: [
        worker(1, "local-1", "docker-local", 3, [agent(0, "claude", "claude-sonnet-5", "claude", "standard"), agent(1, "claude", "claude-opus-5-5", "claude", "deep"), agent(2, "codex", "gpt-5.3-codex", "codex", "fast")]),
        worker(2, "local-2", "docker-local", 2, [agent(3, "claude", "claude-haiku-5", "claude", "fast")]),
      ],
    },
    {
      id: "laptop", label: "laptop", kind: "local", state: "offline", holding: [], last_seen_at: ago(2 * 3_600_000), load: null, hardware: null, agent_max: null, cost: null, control: null,
      nodes: [worker(3, "laptop-1", "docker-local", 2, [], { health: "offline", last_seen_at: ago(2 * 3_600_000) })],
    },
    {
      id: "studio", label: "studio", kind: "local", state: "holding", holding: [CAPABILITY_EXPIRED], last_seen_at: ago(6_000),
      load: { source: "linux", host_probe: "not_applicable", cpu_busy_bps: 2350, memory_used_bps: 4000, cpu_avg_15m_bps: 2000, memory_avg_15m_bps: 3900, samples_15m: 58, observed_at: ago(6_000), fresh: true },
      hardware: { logical_cpus: 8, memory_total_bytes: 32 * 2 ** 30, disk_total_bytes: 1e12, disk_free_bytes: 600e9 }, agent_max: 2, cost: null, control: null,
      nodes: [worker(4, "studio-1", "docker-local", 2, [], { holding: [CAPABILITY_EXPIRED] })],
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

// Explicitly synthetic stress fixture; no sessions or terminal links refer to real agents.
export const SWARM_LARGE_FLEET: Swarm = {
  ...SWARM_MOCKUP,
  server: { ...SWARM_MOCKUP.server, running_agents: 200 },
  machines: [{
    ...SWARM_MOCKUP.machines[0]!, id: "fixture-fleet", label: "Fixture fleet", agent_max: 204,
    nodes: [0, 1].map((workerIndex) => worker(100 + workerIndex, `fixture-worker-${workerIndex + 1}`, "fixture", workerIndex === 0 ? 152 : 52,
      Array.from({ length: workerIndex === 0 ? 150 : 50 }, (_, index): SwarmAgent => {
        const n = (workerIndex === 0 ? 0 : 150) + index;
        return {
          session_id: uuid(1000 + n), attempt_id: uuid(2000 + n),
          task: { id: uuid(3000 + n), title: `Fixture task ${n + 1}` },
          project: { id: uuid(4000), label: "Fixture project" },
          provider: "fixture", model: "fixture", harness: "fixture", intelligence_class: "standard",
          terminal: null, started_at: ago(12 * 60_000),
        };
      }))),
  }],
  waiting: { reasons: [NO_FREE_SLOT], agents: Array.from({ length: 20 }, (_, n) => ({
    task: { id: uuid(5000 + n), title: `Fixture waiting task ${n + 1}` },
    project: { id: uuid(4000), label: "Fixture project" }, provider: "fixture", intelligence_class: "standard" as const,
    reasons: [NO_FREE_SLOT], since: ago(2 * 60_000),
  })) },
};

const stoppedService = { state: "stopped", since: ago(60_000) } as const;
/** The desktop machine after the owner stopped its worker; one handoff is still pending. */
export const SWARM_STOPPED: Swarm = {
  ...SWARM_MOCKUP,
  machines: SWARM_MOCKUP.machines.map((m) => m.id !== "desktop" ? m : {
    ...m, state: "stopped", control: { desired: "stopped", generation: "2", since: ago(60_000), pending_handoffs: 1 },
    nodes: m.nodes.map((n) => ({ ...n, service: stoppedService })),
  }),
};

/*
 * Demo fixtures (`?scenario=swarm-demo` and `?scenario=swarm-demo-next`): the shape of the live stack. A desktop with
 * two worker nodes of eight slots each and a laptop with one worker node of four: twenty slots on three workers. Each
 * node runs as many agents at once as it has slots, and each agent row carries its `slot` on its node. Seven slots are
 * busy (five running, one starting, one finishing) and thirteen are free. Explicitly synthetic: the tasks, sessions
 * and attempts refer to nothing real, and mock mode's banner says so on screen.
 *
 * `swarm-demo-next` is the shape aq-server sends now: every attempt that holds a slot is listed with its `slot`,
 * `phase`, real `title`, `ran_with` and `last_output_at`.
 *
 * `swarm-demo` is the same nodes with an older server's rows: an agent is listed only while it runs, its task `title`
 * is the task's id, and the row has no role, reasoning effort or output time. A slot an attempt holds before its agent
 * starts (or after it stops) is only counted in `slots.occupied`. The page fills titles, roles and effort from each
 * task's own reads, which the demo handlers below serve.
 */
type Demo = { title: string; project: number; role: string; level: [id: string, name: string]; model: string; provider: string; harness: string; reasoning: string; cls: SwarmAgent["intelligence_class"]; ranMs: number; outputAgoMs: number };
const demo = (title: string, project: number, role: string, level: Demo["level"], model: string, reasoning: string, ranMs: number, outputAgoMs = 2_000): Demo => {
  const codex = model.startsWith("gpt");
  return { title, project, role, level, model, reasoning, ranMs, outputAgoMs, provider: codex ? "openai" : "anthropic", harness: codex ? "codex" : "claude", cls: /haiku|mini/.test(model) ? "fast" : /opus/.test(model) ? "deep" : "standard" };
};
const HIGH: Demo["level"] = ["standard-high", "Standard, high"], MEDIUM: Demo["level"] = ["standard-medium", "Standard, medium"], COMPLEX: Demo["level"] = ["complex-low", "Complex, low"], SIMPLE: Demo["level"] = ["simple-high", "Simple, high"];
export const DEMO_PROJECTS = [{ id: uuid(7001), label: "Fixture: storefront" }, { id: uuid(7002), label: "Fixture: billing service" }, { id: uuid(7003), label: "Fixture: docs site" }];
// Five running agents, then one starting and one finishing.
const DEMO_AGENTS: Demo[] = [
  demo("Add retry backoff to the webhook sender", 1, "developer", HIGH, "claude-sonnet-5-5", "high", 9 * 60_000 + 12_000),
  demo("Fix the flaky checkout cancellation test", 0, "developer", HIGH, "claude-sonnet-5-5", "high", 4 * 60_000 + 3_000),
  demo("Review: migrate invoices to the new ledger tables", 1, "reviewer", COMPLEX, "claude-opus-5-5", "low", 2 * 60_000 + 41_000, 48_000),
  demo("Rename the cart reducer's actions", 0, "developer", SIMPLE, "claude-haiku-5-5", "high", 9_000),
  demo("Write the upgrade guide for the 4.0 release with every breaking change and a migration example for each one", 2, "writer", MEDIUM, "claude-sonnet-5-5", "medium", 71_000),
  demo("Add rate limiting to the public search endpoint", 0, "developer", HIGH, "claude-sonnet-5-5", "high", 0),
  demo("Tidy the release notes template", 2, "writer", SIMPLE, "claude-haiku-5-5", "high", 3 * 60_000),
];
const DEMO_RUNNING = 5, DEMO_STARTING = 5, DEMO_FINISHING = 6;
/** The three worker nodes as the live server lists them, with their slot counts and which demo agent holds which slot. */
const DEMO_WORKERS: { machine: 0 | 1; name: string; total: number; agents: [slot: number, agent: number][] }[] = [
  { machine: 0, name: "Local Worker 1", total: 8, agents: [[1, 0], [2, 1], [4, 2]] },
  { machine: 0, name: "Local Worker 2", total: 8, agents: [[1, 3], [2, DEMO_STARTING], [3, 4]] },
  { machine: 1, name: "Local Worker 3", total: 4, agents: [[1, DEMO_FINISHING]] },
];
const demoTask = (i: number) => uuid(7100 + i), demoAttempt = (i: number) => uuid(7200 + i), demoSession = (i: number) => uuid(7300 + i);
const demoRanWith = (d: Demo) => ({ role: d.role, level: d.level[0], provider: d.provider, model: d.model, reasoning: d.reasoning, harness: d.harness, execution_profile: "fixture-sandbox", snapshot_digest: "d".repeat(64) });

/** The demo swarm at `now`. `next` is the shape the server sends now; without it, an older server's. */
export function demoSwarm(now: string, next = false): Swarm {
  const at = (ms: number) => new Date(Date.parse(now) - ms).toISOString();
  const row = (d: Demo, i: number): SwarmAgent => ({
    session_id: demoSession(i), attempt_id: demoAttempt(i), task: { id: demoTask(i), title: next ? d.title : demoTask(i) }, project: DEMO_PROJECTS[d.project]!,
    provider: d.provider, model: d.model, harness: d.harness, intelligence_class: d.cls, routing_profile: { id: d.level[0], display_name: d.level[1] },
    terminal: null, started_at: i === DEMO_STARTING ? null : at(d.ranMs),
    ...(next ? { phase: i < DEMO_RUNNING ? "running" as const : i === DEMO_STARTING ? "starting" as const : "finishing" as const, ran_with: demoRanWith(d), last_output_at: i === DEMO_STARTING ? null : at(i === DEMO_FINISHING ? 20_000 : d.outputAgoMs) } : {}),
  });
  const nodes = (machine: 0 | 1): SwarmNode[] => DEMO_WORKERS.map((w, index) => ({ w, index })).filter(x => x.w.machine === machine).map(({ w, index }) => {
    const held = w.agents.length;
    const agents = w.agents.filter(([, i]) => next || i < DEMO_RUNNING).map(([slot, i]): SwarmAgent => ({ ...row(DEMO_AGENTS[i]!, i), slot }));
    return { ...worker(7400 + index, w.name, "docker-local", w.total, agents, { service: { state: "running", since: at(3_600_000) }, last_seen_at: at(1_500) }), slots: { total: w.total, occupied: held, idle: w.total - held } };
  });
  const machine = (id: string, label: string, cpus: number, cpu: number, ram: number, agentMax: number, list: SwarmNode[]): Swarm["machines"][number] => ({
    id, label, kind: "local", state: "online", holding: [], last_seen_at: at(1_500),
    load: { source: "windows_host", host_probe: "fresh", cpu_busy_bps: cpu, memory_used_bps: ram, cpu_avg_15m_bps: cpu - 600, memory_avg_15m_bps: ram - 200, samples_15m: 60, observed_at: at(4_000), fresh: true },
    hardware: { logical_cpus: cpus, memory_total_bytes: (cpus > 16 ? 64 : 32) * 2 ** 30, disk_total_bytes: 2e12, disk_free_bytes: 294e9 }, agent_max: agentMax, cost: null,
    control: { desired: "running", generation: "3", since: at(3_600_000), pending_handoffs: 0 }, nodes: list,
  });
  return {
    server: { version: "0.1.0", source_revision: next ? "4544f8700f9d02d3291e0566da332114efee9497" : "58a95b992d64a9d4b587e6c3c38a857c6041edd4", running_agents: next ? DEMO_AGENTS.length : DEMO_RUNNING, owner_availability: { state: "on", generation: "2", since: at(3_600_000) } },
    machines: [
      machine("desktop", "Fixture desktop", 24, 7400, 6100, 16, nodes(0)),
      machine("laptop", "Fixture laptop", 12, 5200, 4800, 8, nodes(1)),
    ],
    waiting: { reasons: [], agents: [] },
  };
}

/** The task reads the page falls back to for the demo's titles and `ran_with`; any other task falls through to the Graph fixtures. */
export function swarmDemoGraphHandlers(scenarioName?: string | null) {
  if (scenarioName !== "swarm-demo") return [];
  const find = (project: unknown, task: unknown) => { const i = DEMO_AGENTS.findIndex((d, n) => demoTask(n) === task && DEMO_PROJECTS[d.project]!.id === project); return i < 0 ? null : { d: DEMO_AGENTS[i]!, i }; };
  const wrap = (project: (typeof DEMO_PROJECTS)[number], data: unknown) => ({ contract: "human-graph-1", project: { id: project.id, name: project.label, revision: "1", workspace_id: uuid(7000) }, observed_at: SERVER_TIME, data });
  return [
    http.get("/api/human/projects/:project/tasks/:task", ({ params }) => {
      const hit = find(params.project, params.task);
      if (!hit) return undefined;
      return HttpResponse.json(wrap(DEMO_PROJECTS[hit.d.project]!, {
        task_state: "active", verification: "unverified", content_type: "note", last_verified_by: null, last_verified_at: null, retirement_reason: null, valid_from: null, valid_until: null, review_at: null,
        successor_id: null, summary: null, summary_of_revision: null, id: demoTask(hit.i), kind: "task", title: hit.d.title, body: "Mock-mode demo fixture. Not live AQ data.", acceptance_criteria: "", labels: [],
        retired: false, deleted: false, created_at: SERVER_TIME, updated_at: SERVER_TIME, created_by: "demo-fixture", provenance: [], version: "1", content_revision: "1", role: { id: hit.d.role, source: "task" },
      }));
    }),
    http.get("/api/human/projects/:project/tasks/:task/work", ({ params }) => {
      const hit = find(params.project, params.task);
      if (!hit) return undefined;
      return HttpResponse.json(wrap(DEMO_PROJECTS[hit.d.project]!, {
        task_id: demoTask(hit.i), task_state: "active", version: "1", role: { id: hit.d.role, source: "task" }, readiness: { state: "running", blockers: [], complete: true, reasons: [] }, parent: null,
        execution: { task_id: demoTask(hit.i), attempt_id: demoAttempt(hit.i), session_id: demoSession(hit.i), status: "granted", ran_with: demoRanWith(hit.d) },
      }));
    }),
  ];
}

export function swarmEnvelope<T>(data: T, serverTime: string = SERVER_TIME) {
  return {
    api_version: "proposed-0", request_id: "mock", server_time: serverTime, scope: { kind: "all_authorized" }, data,
    observation: { observed_at: serverTime, fresh_until: new Date(Date.parse(serverTime) + (serverTime === SERVER_TIME ? 30_000 : 5_000)).toISOString(), source: "mock", quality: "reported", coverage: "complete" },
    pending_operations: [], coverage: { state: "complete" },
  };
}

/** `?scenario=swarm-availability-off|unset` serves the owner availability switch in that state (default is on). */
const AVAILABILITY_SCENARIOS: Record<string, OwnerAvailability> = {
  "swarm-availability-off": { state: "off", generation: "3", since: ago(600_000) },
  "swarm-availability-unset": { state: "unset", generation: "4", since: null, note: "The switch was set by a former owner, so it reads as unset." },
};

export function swarmHandlers(reads: "ok" | "partial" | "empty" | "failed", scenarioName?: string | null) {
  const availability = AVAILABILITY_SCENARIOS[scenarioName ?? ""];
  // The demo's clock runs from when the mock started, so elapsed timers count between polls instead of restarting.
  const started = Date.now();
  const demoNow = () => new Date(Date.parse(SERVER_TIME) + (Date.now() - started)).toISOString();
  const isDemo = scenarioName === "swarm-demo" || scenarioName === "swarm-demo-next";
  const swarm = scenarioName === "swarm-large-fleet" ? SWARM_LARGE_FLEET : availability ? { ...SWARM_MOCKUP, server: { ...SWARM_MOCKUP.server, owner_availability: availability } } : SWARM_MOCKUP;
  return [
    http.get("/api/v1/swarm", () => {
      if (reads === "failed") return HttpResponse.json({ request_id: "mock", code: "read_model_unavailable", message: "The read model is temporarily unavailable.", retryable: true }, { status: 503 });
      if (reads === "empty") return HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines: [], waiting: { reasons: [NO_MACHINE_ONLINE], agents: [] } }));
      if (isDemo) { const now = demoNow(); return HttpResponse.json(swarmEnvelope(demoSwarm(now, scenarioName === "swarm-demo-next"), now)); }
      return HttpResponse.json(swarmEnvelope(swarm));
    }),
  ];
}
