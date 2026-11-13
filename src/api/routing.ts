import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

/** The routing policy's compile state and the routing switch (spec 0011 §6, §8). */
export const ROUTING_POLICY_PATH = "/api/settings/intelligence/routing";
export const ROUTING_COMPILE_STATUSES = ["compiling", "active", "superseded", "failed"] as const;
export type RoutingCompileStatus = typeof ROUTING_COMPILE_STATUSES[number];
/** Where in the compiled policy, and what is wrong there, in words. */
export type RoutingProblem = { path: string; message: string };
/** The compiled policy that routes, in the owner's words, and what in Settings it no longer fits. */
export type RoutingActive = {
  digest: string; structure_revision: number; summary: string[]; created_at_ms: number; took_effect_at_ms: number | null; problems: RoutingProblem[];
};
/** The newest compile, whatever its outcome. */
export type RoutingLatest = {
  status: RoutingCompileStatus; structure_revision: number; error: string | null; problems: RoutingProblem[]; unresolved: string[];
  internal_task_id: string | null; created_at_ms: number; finished_at_ms: number | null;
};
export type RoutingPolicyState = { enabled: boolean; active: RoutingActive | null; latest: RoutingLatest | null };

function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid routing policy response"); }
const text = (value: unknown, max = 64 * 1024): value is string => typeof value === "string" && value.length <= max;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1024 && value.every(item => text(item));
function problems(value: unknown): RoutingProblem[] {
  ensure(Array.isArray(value) && value.length <= 1024);
  return value.map(item => { ensure(isRecord(item) && text(item.path, 512) && text(item.message, 4096)); return { path: item.path, message: item.message }; });
}
function active(value: unknown): RoutingActive | null {
  if (value === null) return null;
  ensure(isRecord(value) && text(value.digest, 128) && count(value.structure_revision) && texts(value.summary) && count(value.created_at_ms));
  ensure(value.took_effect_at_ms === null || count(value.took_effect_at_ms));
  return { digest: value.digest, structure_revision: value.structure_revision, summary: value.summary, created_at_ms: value.created_at_ms,
    took_effect_at_ms: value.took_effect_at_ms as number | null, problems: problems(value.problems) };
}
function latest(value: unknown): RoutingLatest | null {
  if (value === null) return null;
  ensure(isRecord(value) && ROUTING_COMPILE_STATUSES.includes(value.status as RoutingCompileStatus) && count(value.structure_revision) && count(value.created_at_ms));
  ensure((value.error === null || text(value.error)) && texts(value.unresolved));
  ensure((value.internal_task_id === null || text(value.internal_task_id, 64)) && (value.finished_at_ms === null || count(value.finished_at_ms)));
  return { status: value.status as RoutingCompileStatus, structure_revision: value.structure_revision, error: value.error as string | null, problems: problems(value.problems),
    unresolved: value.unresolved, internal_task_id: value.internal_task_id as string | null, created_at_ms: value.created_at_ms, finished_at_ms: value.finished_at_ms as number | null };
}
export function adaptRoutingPolicy(value: unknown): RoutingPolicyState {
  ensure(isRecord(value) && typeof value.enabled === "boolean");
  return { enabled: value.enabled, active: active(value.active), latest: latest(value.latest) };
}
export async function readRoutingPolicy(signal?: AbortSignal) { return adaptRoutingPolicy(await apiGet<unknown>(ROUTING_POLICY_PATH, signal)); }
/** Turns routing on (only while a compiled policy is active) or off. */
export async function setRouting(enabled: boolean) { return adaptRoutingPolicy(await apiSend<unknown>("POST", ROUTING_POLICY_PATH, { enabled })); }
