/** Wire types for `GET /api/v1/swarm` (aq-server protocol/dashboard-read/v1, spec 0007). Field names are the contract's. */
export type Timestamp = string;
export type EntityRef = { id: string; type: string; revision?: unknown };
export type TitledRef = { id: string; title: string; revision?: unknown };
export type ProjectRef = { id: string; label: string };

export type MachineKind = "local" | "cloud";
export type MachineState = "online" | "holding" | "offline" | "stopped" | "booting";
export type LoadSource = "linux" | "windows_host";
export type HostProbe = "not_applicable" | "fresh" | "stale" | "missing";
export type ServiceState = "running" | "stopped" | "draining" | "unreported";
export type ReportedState = "ready" | "unavailable" | "unreported";
export type IntelligenceClass = "fast" | "standard" | "deep";
export type HoldCode =
  | "worker_offline" | "worker_revoked" | "worker_stopped" | "worker_draining"
  | "capability_unreported" | "capability_expired"
  | "measurement_expired" | "measurement_unavailable"
  | "node_spend_ceiling_reached" | "node_spend_unaccounted" | "node_disk_pressure"
  | "cpu_above_threshold" | "memory_above_threshold" | "agent_maximum_reached"
  | "no_machine_online" | "no_eligible_machine" | "no_free_slot" | "history_rate_limited" | "history_cap_reached";

export type HoldReason = { code: HoldCode; message: string; remedy?: string };
export type MachineLoad = {
  source: LoadSource; host_probe: HostProbe;
  cpu_busy_bps: number; memory_used_bps: number; cpu_avg_15m_bps: number | null; memory_avg_15m_bps: number | null; samples_15m: number;
  observed_at: Timestamp; fresh: boolean;
};
export type MachineHardware = { logical_cpus: number; memory_total_bytes: number; disk_total_bytes: number | null; disk_free_bytes: number | null };
export type MachineCost = { currency: string; micros_per_hour: number; started_at: Timestamp };
export type MachineControl = { desired: "running" | "draining" | "stopped"; generation: string; since: Timestamp | null; pending_handoffs: number };
export type OwnerAvailability = { state: "unset" | "on" | "off"; generation: string; since: Timestamp | null; note?: string | null };
export type WorkerService = { state: ServiceState; since: Timestamp | null };
export type NodeSlots = { total: number | null; occupied: number; idle: number | null };
export type SwarmAgent = {
  session_id: string; attempt_id: string; task: TitledRef | null; project: ProjectRef;
  provider: string | null; model: string | null; harness: string | null; intelligence_class: IntelligenceClass | null;
  terminal: EntityRef | null; started_at: Timestamp | null;
};
export type SwarmNode = {
  node: EntityRef; name: string; health: "online" | "offline" | "revoked" | "unknown"; service: WorkerService;
  backend_kind: string | null; worker_version: string; sandbox_templates: string[]; agent_channel: ReportedState;
  last_seen_at: Timestamp | null; slots: NodeSlots; holding: HoldReason[]; agents: SwarmAgent[];
};
export type SwarmMachine = {
  id: string; label: string; kind: MachineKind; state: MachineState; holding: HoldReason[];
  last_seen_at: Timestamp | null; load: MachineLoad | null; hardware: MachineHardware | null;
  agent_max: number | null; cost: MachineCost | null; control?: MachineControl | null; nodes: SwarmNode[];
};
export type WaitingAgent = {
  task: TitledRef; project: ProjectRef; provider: string | null; intelligence_class: IntelligenceClass | null;
  reasons: HoldReason[]; since: Timestamp | null;
};
export type SwarmWaiting = { reasons: HoldReason[]; agents: WaitingAgent[] };
export type SwarmServer = { version: string; source_revision: string; running_agents: number; owner_availability?: OwnerAvailability | null };
export type Swarm = { server: SwarmServer; machines: SwarmMachine[]; waiting: SwarmWaiting };
