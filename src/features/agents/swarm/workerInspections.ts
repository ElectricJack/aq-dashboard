import { apiGet } from "../../../api/client";
import { ContractError, isRecord, nullable, optional } from "../../../api/adapters/contract";

const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const rowsOf = <T,>(value: unknown, valid: (row: unknown) => row is T): value is T[] =>
  Array.isArray(value) && value.every(valid);

export type Report = { ok: boolean; phase?: string; error?: string; details?: Record<string, unknown> };
export type Job = {
  id: string; node_id: string; kind: "sandbox_startup_v1" | "receiver_update_v1";
  status: "queued" | "running" | "completed"; result: Report | null;
};
export type Receiver = { node_id: string; seen_at_ms: number; version: number };

function validReport(value: unknown): value is Report {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  return optional(value.phase, isText) && optional(value.error, isText) && optional(value.details, isRecord);
}

function validJob(value: unknown): value is Job {
  if (!isRecord(value)) return false;
  const identity = isText(value.id) && isText(value.node_id);
  const kind = ["sandbox_startup_v1", "receiver_update_v1"].includes(String(value.kind));
  const status = ["queued", "running", "completed"].includes(String(value.status));
  return identity && kind && status && nullable(value.result, validReport);
}

function validReceiver(value: unknown): value is Receiver {
  if (!isRecord(value)) return false;
  return isText(value.node_id) && isNumber(value.seen_at_ms) && isNumber(value.version);
}

export async function readWorkerDiagnostics(signal: AbortSignal) {
  const raw = await apiGet<unknown>("/api/worker-diagnostics", signal);
  if (isRecord(raw) && isNumber(raw.server_time_ms)) {
    if (rowsOf(raw.jobs, validJob) && rowsOf(raw.receivers, validReceiver)) {
      return { jobs: raw.jobs, receivers: raw.receivers, server_time_ms: raw.server_time_ms };
    }
  }
  throw new ContractError("Invalid worker diagnostics");
}

export type Delivery = {
  node_id: string; generation: string | null; providers: string[];
  status: "waiting" | "pending" | "applied" | "failed"; receiver_seen_at_ms: number | null;
};
const validProvider = (value: unknown): value is string => value === "anthropic" || value === "openai";
function validDelivery(value: unknown): value is Delivery {
  if (!isRecord(value)) return false;
  const identity = isText(value.node_id) && nullable(value.generation, isText);
  const status = ["waiting", "pending", "applied", "failed"].includes(String(value.status));
  return identity && status && rowsOf(value.providers, validProvider) && nullable(value.receiver_seen_at_ms, isNumber);
}

export async function readWorkerLogins(signal: AbortSignal) {
  const raw = await apiGet<unknown>("/api/worker-logins", signal);
  if (!isRecord(raw)) throw new ContractError("Invalid login delivery status");
  if (rowsOf(raw.deliveries, validDelivery) && isNumber(raw.server_time_ms)) {
    return { deliveries: raw.deliveries, server_time_ms: raw.server_time_ms };
  }
  throw new ContractError("Invalid login delivery status");
}
