import { ContractError, isRecord } from "./contract";
import type { MachineControl, OwnerAvailability, Swarm, SwarmAgent, SwarmMachine, SwarmNode, HoldReason, MachineLoad, WaitingAgent } from "../wire/swarm";

/**
 * The swarm read is polled; aq-server offers no event stream for it. Each response is fresh for five seconds
 * (`observation.fresh_until`), and tasks can start and finish within ten, so two seconds keeps the page inside
 * the freshness window with a poll to spare. Polling stops while the tab is hidden (the query client's default).
 */
export const SWARM_POLL_MS = 2_000;

export type HoldReasonView = { code: string; message: string; remedy: string | null };
export type LoadView = { source: "linux" | "windows_host" | "unknown"; hostProbe: "not_applicable" | "fresh" | "stale" | "missing";
  cpuPercent: number; memoryPercent: number; cpuAvgPercent: number | null; memoryAvgPercent: number | null; samples: number; observedAt: string; fresh: boolean };
export type AgentView = { manual?: import("../../features/agents/swarm/manualAgents").ManualAgent; sessionId: string; attemptId: string; task: { id: string; title: string } | null; project: { id: string; label: string };
  provider: string | null; model: string | null; harness: string | null; intelligenceClass: "fast" | "standard" | "deep" | null;
  routingProfile?: { id: string; displayName: string } | null;
  terminalId: string | null; startedAt: string | null;
  /** Where the attempt is, when the server says; absent from a server that lists only running agents. */
  phase?: "starting" | "running" | "finishing";
  /** What the attempt ran with: from the swarm row when it carries it, else from the task's work read. */
  ranWith?: RanWithView | null;
  /** Last terminal output, when the read carries it. Output is not progress. */
  lastOutputAt?: string | null;
  /** The node slot the attempt holds, from one; absent from a row that names none. */
  slot?: number };
export type RanWithView = { role: string; level: string; provider: string; model: string; reasoning: string; harness: string };
export type NodeView = { id: string; name: string; health: "online" | "offline" | "revoked" | "unknown";
  service: "running" | "stopped" | "draining" | "unreported"; serviceSince: string | null; backendKind: string | null; workerVersion: string;
  sandboxTemplates: string[]; agentChannel: "ready" | "unavailable" | "unreported"; lastSeenAt: string | null;
  /** `held`: slots an attempt holds for which the read names no agent (occupied minus the agents listed). */
  slots: { total: number | null; occupied: number; idle: number | null; held?: number; scope?: string; target?:number };
  /** The node's slot count as the server reports it (`slots.total`); absent when it reports none. The interactive fleet's per-project limits never replace it. */
  capacity?: number;
  holding: HoldReasonView[]; agents: AgentView[] };
export type MachineControlView = { desired: "running" | "draining" | "stopped"; generation: string; since: string | null; pendingHandoffs: number };
export type OwnerAvailabilityView = { state: "unset" | "on" | "off"; generation: string; since: string | null; note: string | null };
export type MachineView = { id: string; label: string; kind: "local" | "cloud" | "unknown"; state: "online" | "holding" | "offline" | "stopped" | "booting" | "unknown";
  holding: HoldReasonView[]; lastSeenAt: string | null; load: LoadView | null;
  hardware: { logicalCpus: number | null; memoryTotalBytes: number; diskTotalBytes: number | null; diskFreeBytes: number | null } | null;
  agentMax: number | null; cost: { currency: string; microsPerHour: number; startedAt: string } | null; control: MachineControlView | null; controlUnrecognised: boolean; nodes: NodeView[] };
export type WaitingAgentView = { taskId: string; title: string; project: { id: string; label: string }; provider: string | null;
  intelligenceClass: "fast" | "standard" | "deep" | null; reasons: HoldReasonView[]; since: string | null };
export type SwarmView = { serverTime: string; server: { version: string; sourceRevision: string; runningAgents: number | null; ownerAvailability: OwnerAvailabilityView | null };
  machines: MachineView[]; waiting: { reasons: HoldReasonView[]; agents: WaitingAgentView[] } };

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const percent = (bps: unknown): number => Math.round((num(bps) ?? 0) / 100);

const GENERATION = /^[1-9][0-9]{0,18}$/;
function control(c: MachineControl | null | undefined): MachineControlView | null {
  if (!isRecord(c)) return null;
  const desired = oneOfOrNull(c.desired, ["running", "draining", "stopped"] as const);
  if (!desired || typeof c.generation !== "string" || !GENERATION.test(c.generation)) return null;
  return { desired, generation: c.generation, since: text(c.since), pendingHandoffs: num(c.pending_handoffs) ?? 0 };
}
function availability(a: OwnerAvailability | null | undefined): OwnerAvailabilityView | null {
  if (!isRecord(a)) return null;
  const state = oneOfOrNull(a.state, ["unset", "on", "off"] as const);
  if (!state || typeof a.generation !== "string" || !GENERATION.test(a.generation)) return null;
  return { state, generation: a.generation, since: text(a.since), note: text(a.note) };
}

const CLASSES = ["fast", "standard", "deep"] as const;
const PHASES = ["starting", "running", "finishing"] as const;

function hold(r: HoldReason): HoldReasonView {
  return { code: String(r?.code ?? ""), message: String(r?.message ?? ""), remedy: text(r?.remedy) };
}
const holds = (v: unknown): HoldReasonView[] => list<HoldReason>(v).filter(isRecord).map(hold);

function load(l: MachineLoad | null | undefined): LoadView | null {
  if (!isRecord(l)) return null;
  const cpu = num(l.cpu_busy_bps);
  const memory = num(l.memory_used_bps);
  if (cpu === null || memory === null || cpu < 0 || cpu > 10_000 || memory < 0 || memory > 10_000) return null;
  return {
    source: oneOf(l.source, ["linux", "windows_host"] as const, "unknown" as const),
    hostProbe: oneOf(l.host_probe, ["not_applicable", "fresh", "stale", "missing"] as const, "not_applicable"),
    cpuPercent: percent(cpu), memoryPercent: percent(memory),
    cpuAvgPercent: l.cpu_avg_15m_bps == null ? null : percent(l.cpu_avg_15m_bps), memoryAvgPercent: l.memory_avg_15m_bps == null ? null : percent(l.memory_avg_15m_bps),
    samples: num(l.samples_15m) ?? 0, observedAt: text(l.observed_at) ?? "", fresh: l.fresh === true,
  };
}

/** Legacy servers did not report the routing profile; preserve their display label. */
export function agentClassLabel(agent: AgentView): string {
  if (agent.manual?.spec.profile_name) return agent.manual.spec.profile_name;
  return agent.routingProfile === undefined ? agent.intelligenceClass ?? "unclassified" : agent.routingProfile?.displayName ?? "unclassified";
}

const RAN_WITH = ["role", "level", "provider", "model", "reasoning", "harness"] as const;
/** The six facts the page shows, or null when any is missing: a partial record is not shown as a whole one. */
export function adaptAgentRanWith(v: unknown): RanWithView | null {
  if (!isRecord(v) || !RAN_WITH.every(key => typeof v[key] === "string" && (v[key] as string).trim() !== "" && (v[key] as string).length <= 256)) return null;
  return Object.fromEntries(RAN_WITH.map(key => [key, v[key]])) as RanWithView;
}

const slotIndex = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4096 ? v : null);
/**
 * The node's slot count, or null when the server does not report one (an old worker). `slots.total` is the node's one
 * slot count, a per-node Setting, shared by queued tasks and hand-started sessions.
 */
function slotCount(slots: Record<string, unknown>): number | null {
  const total = num(slots.total);
  return total === null || !Number.isInteger(total) || total < 0 ? null : total;
}

function agent(a: SwarmAgent): AgentView {
  return {
    sessionId: String(a.session_id), attemptId: String(a.attempt_id),
    task: isRecord(a.task) ? { id: String(a.task.id), title: String(a.task.title) } : null,
    project: { id: String(a.project?.id ?? ""), label: String(a.project?.label ?? "") },
    provider: text(a.provider), model: text(a.model), harness: text(a.harness),
    intelligenceClass: oneOfOrNull(a.intelligence_class, CLASSES),
    ...(a.routing_profile === undefined ? {} : { routingProfile: isRecord(a.routing_profile) && typeof a.routing_profile.id === "string" && a.routing_profile.id.trim() && typeof a.routing_profile.display_name === "string" && a.routing_profile.display_name.trim() ? { id: a.routing_profile.id, displayName: a.routing_profile.display_name } : null }),
    terminalId: isRecord(a.terminal) ? text(a.terminal.id) : null, startedAt: text(a.started_at),
    ...(oneOfOrNull(a.phase, PHASES) ? { phase: oneOfOrNull(a.phase, PHASES)! } : {}),
    ...(a.ran_with === undefined ? {} : { ranWith: adaptAgentRanWith(a.ran_with) }),
    ...(a.last_output_at === undefined ? {} : { lastOutputAt: text(a.last_output_at) }),
    ...(slotIndex(a.slot) === null ? {} : { slot: slotIndex(a.slot)! }),
  };
}

function node(n: SwarmNode): NodeView {
  const slots = isRecord(n.slots) ? n.slots : { total: null, occupied: 0, idle: null };
  const agents = list<SwarmAgent>(n.agents).filter(isRecord).map(agent);
  const capacity = slotCount(slots as Record<string, unknown>);
  return {
    ...(capacity === null ? {} : { capacity }),
    id: String(n.node?.id ?? ""), name: String(n.name ?? ""),
    health: oneOf(n.health, ["online", "offline", "revoked"] as const, "unknown" as const),
    service: oneOf(n.service?.state, ["running", "stopped", "draining", "unreported"] as const, "unreported"),
    serviceSince: text(n.service?.since), backendKind: text(n.backend_kind), workerVersion: String(n.worker_version ?? ""),
    sandboxTemplates: list<unknown>(n.sandbox_templates).filter((t): t is string => typeof t === "string"),
    agentChannel: oneOf(n.agent_channel, ["ready", "unavailable", "unreported"] as const, "unreported"),
    lastSeenAt: text(n.last_seen_at),
    // `held`: slots the server counts as occupied for which it lists no agent row.
    slots: { total: num(slots.total), occupied: num(slots.occupied) ?? 0, idle: num(slots.idle), held: Math.max(0, (num(slots.occupied) ?? 0) - agents.length) },
    holding: holds(n.holding), agents,
  };
}

function machine(m: SwarmMachine): MachineView {
  if (!isRecord(m) || typeof m.id !== "string" || typeof m.label !== "string") throw new ContractError("swarm machine needs id and label");
  const hw = isRecord(m.hardware) ? m.hardware : null;
  const cost = isRecord(m.cost) ? m.cost : null;
  return {
    id: m.id, label: m.label, kind: oneOf(m.kind, ["local", "cloud"] as const, "unknown" as const),
    state: oneOf(m.state, ["online", "holding", "offline", "stopped", "booting"] as const, "unknown" as const),
    holding: holds(m.holding), lastSeenAt: text(m.last_seen_at), load: load(m.load),
    hardware: hw ? { logicalCpus: num(hw.logical_cpus), memoryTotalBytes: num(hw.memory_total_bytes) ?? 0, diskTotalBytes: num(hw.disk_total_bytes), diskFreeBytes: num(hw.disk_free_bytes) } : null,
    agentMax: num(m.agent_max),
    cost: cost ? { currency: String(cost.currency), microsPerHour: num(cost.micros_per_hour) ?? 0, startedAt: String(cost.started_at) } : null,
    control: control(m.control), controlUnrecognised: isRecord(m.control) && control(m.control) === null,
    nodes: list<SwarmNode>(m.nodes).filter(isRecord).map(node),
  };
}

function waitingAgent(w: WaitingAgent): WaitingAgentView {
  return {
    taskId: String(w.task?.id ?? ""), title: String(w.task?.title ?? ""), project: { id: String(w.project?.id ?? ""), label: String(w.project?.label ?? "") },
    provider: text(w.provider), intelligenceClass: oneOfOrNull(w.intelligence_class, CLASSES), reasons: holds(w.reasons), since: text(w.since),
  };
}

/** Unknown fields and unknown enum values degrade (to "unknown", null or "unreported"); a malformed shape is a contract error. */
export function adaptSwarm(raw: Swarm, serverTime: string): SwarmView {
  if (!isRecord(raw) || !Array.isArray(raw.machines) || !isRecord(raw.waiting)) throw new ContractError("swarm needs machines and waiting");
  const server = isRecord(raw.server) ? raw.server : { version: "", source_revision: "", running_agents: null };
  return {
    serverTime,
    server: { version: String(server.version ?? ""), sourceRevision: String(server.source_revision ?? ""), runningAgents: num(server.running_agents), ownerAvailability: availability((server as { owner_availability?: OwnerAvailability | null }).owner_availability) },
    machines: raw.machines.map(machine),
    waiting: { reasons: holds(raw.waiting.reasons), agents: list<WaitingAgent>(raw.waiting.agents).filter(isRecord).map(waitingAgent) },
  };
}
