import { boundedList, ContractError, isRecord, nullable, optional, positiveInteger } from "../../../api/adapters/contract";
import { validGraphId } from "../../../api/adapters/humanGraph";

/** A level and one of its candidates. The server refuses any other selection fields. */
export type IntelligenceSelection = { profile_id: string; candidate_id: string };
/** One entry per level candidate a logged-in harness can run. */
export type LaunchProfile = IntelligenceSelection & {
  name: string; provider: string; model: string; reasoning: string; harness: string; snapshot_digest?: string;
};
export const launchProfileKey = (profile: IntelligenceSelection) => `${profile.profile_id} ${profile.candidate_id}`;
export const selectionOf = ({ profile_id, candidate_id }: IntelligenceSelection): IntelligenceSelection => ({ profile_id, candidate_id });

export type ManualAgent = {
  id: string; node_id: string; project_id: string;
  spec: {
    project_name: string; repository_id: string; provider: string; model: string;
    reasoning?: string; harness?: string; intelligence_profile?: IntelligenceSelection; profile_name?: string;
  };
  status: "pending" | "preparing" | "running" | "stopping" | "stopped" | "failed";
  stage: string; desired_running: boolean; created_at_ms: number; updated_at_ms: number; worker_seen_at_ms: number | null; uncertain?: boolean;
};
export type ManualFleet = {
  launch_profiles: LaunchProfile[];
  sessions: ManualAgent[];
  workers: { node_id: string; max_slots: number; repositories: string[]; providers: string[]; observed_at_ms: number }[];
  slots: { node_id: string; project_id: string; slots: number; revision: number }[];
  projects: { id: string; name: string; repository_id: string }[];
  server_time_ms: number;
};

const states = ["pending", "preparing", "running", "stopping", "stopped", "failed"];
const text = (value: unknown): value is string => typeof value === "string";
function boundedText(value: unknown, limit: number) {
  return text(value) && value.length <= limit;
}
function recordKeys(record: Record<string, unknown>, keys: string[], test: (value: unknown) => boolean) {
  return keys.every(key => test(record[key]));
}
export function validLaunchProfile(profile: unknown): profile is LaunchProfile {
  return isRecord(profile)
    && recordKeys(profile, ["profile_id", "candidate_id", "name", "provider", "model", "reasoning", "harness"], text)
    && optional(profile.snapshot_digest, text);
}

function agentSpec(spec: unknown) {
  return isRecord(spec) && boundedText(spec.project_name, 512) && validGraphId(spec.repository_id)
    && recordKeys(spec, ["provider", "model"], text);
}
function agentLifecycle(value: Record<string, unknown>) {
  return states.includes(String(value.status)) && boundedText(value.stage, 256) && typeof value.desired_running === "boolean"
    && recordKeys(value, ["created_at_ms", "updated_at_ms"], Number.isSafeInteger) && nullable(value.worker_seen_at_ms, Number.isSafeInteger);
}
export function manualAgent(value: unknown): value is ManualAgent {
  return isRecord(value) && recordKeys(value, ["id", "node_id", "project_id"], validGraphId) && agentSpec(value.spec) && agentLifecycle(value);
}
function slotCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 8;
}
type ReportedWorker = Omit<ManualFleet["workers"][number], "providers"> & { providers?: unknown };
function workerRecord(value: unknown): value is ReportedWorker {
  return isRecord(value) && validGraphId(value.node_id) && slotCount(value.max_slots) &&
    boundedList(value.repositories, 16, validGraphId) && Number.isSafeInteger(value.observed_at_ms);
}
function slotRecord(value: unknown) {
  return isRecord(value) && recordKeys(value, ["node_id", "project_id"], validGraphId) && slotCount(value.slots) && positiveInteger(value.revision);
}
function projectRecord(value: unknown) {
  return isRecord(value) && recordKeys(value, ["id", "repository_id"], validGraphId) && text(value.name);
}
function providerList(value: unknown) {
  return Array.isArray(value) && value.every(provider => provider === "anthropic" || provider === "openai");
}
function fleetArrays(value: Record<string, unknown>) {
  return recordKeys(value, ["workers", "slots", "projects"], Array.isArray) && Number.isSafeInteger(value.server_time_ms);
}
type FleetPage = Record<string, unknown> & { workers: unknown[]; slots: unknown[]; projects: unknown[] };
function isFleetPage(raw: unknown): raw is FleetPage {
  return isRecord(raw) && boundedList(raw.sessions, 256, manualAgent) && fleetArrays(raw);
}
function validatedWorkers(page: FleetPage) {
  const failure = () => new ContractError("Invalid interactive capacity");
  if (!page.workers.every(workerRecord)) throw failure();
  if (!page.slots.every(slotRecord)) throw failure();
  if (!page.projects.every(projectRecord)) throw failure();
  return page.workers;
}

export function adaptManualFleet(raw: unknown): ManualFleet {
  if (!isFleetPage(raw)) throw new ContractError("Invalid interactive agents");
  const reports = validatedWorkers(raw);
  const profiles = raw.launch_profiles ?? [];
  if (!boundedList(profiles, 2048, validLaunchProfile)) throw new ContractError("Invalid launch profiles");
  if (!reports.every(w => optional(w.providers, providerList))) throw new ContractError("Invalid worker providers");
  const workers = reports.map(w => ({ ...w, providers: w.providers ?? ["anthropic"] }));
  return { ...raw, launch_profiles: profiles, workers } as ManualFleet;
}
