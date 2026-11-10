import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";

export type Candidate = { id: string; provider: string; model: string; reasoning_configuration_reference: string; harnesses: string[] };
export type ModelChoice = { provider: string; model: string; reasoning_configuration_reference: string; reasoning: string; harness: string; preference_only?: boolean; options?: Record<string, unknown>; source?: string; observed_at?: string };
export type IntelligenceProfile = {
  id: string; version: number; name?: string; description?: string; candidates: Candidate[];
  projects: { id: string; name: string; enabled: boolean }[];
};
export type IntelligenceSettings = { revision: string; active_digest: string | null; profiles: IntelligenceProfile[]; model_choices: ModelChoice[] };
export type SaveIntelligence = {
  operation_id: string; expected_revision: string; profile_id: string; profile_version: number;
  name: string; description: string; candidates: Candidate[];
};
export type IntelligenceSaved = { operation_id: string; disposition: "saved" | "unchanged"; revision: string; active_digest: string; profile: Omit<IntelligenceProfile, "projects">; updated_projects: { id: string; name: string; revision: string }[] };
const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.length <= max;
const revision = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid intelligence settings response"); }
function candidate(v: unknown): Candidate {
  ensure(isRecord(v) && text(v.id) && text(v.provider) && text(v.model) && text(v.reasoning_configuration_reference)
    && Array.isArray(v.harnesses) && v.harnesses.length <= 128 && v.harnesses.every(h => text(h)));
  return { id: v.id, provider: v.provider, model: v.model, reasoning_configuration_reference: v.reasoning_configuration_reference, harnesses: v.harnesses as string[] };
}
export function adaptIntelligenceSettings(v: unknown): IntelligenceSettings {
  ensure(isRecord(v) && revision(v.revision) && (v.active_digest === null || digest(v.active_digest))
    && Array.isArray(v.profiles) && v.profiles.length <= 128 && Array.isArray(v.model_choices) && v.model_choices.length <= 4096);
  const profiles = v.profiles.map((p: unknown): IntelligenceProfile => {
    ensure(isRecord(p) && text(p.id, 96) && typeof p.version === "number" && Number.isSafeInteger(p.version) && p.version > 0
      && (p.name === undefined || text(p.name, 128)) && (p.description === undefined || text(p.description, 2000))
      && Array.isArray(p.candidates) && p.candidates.length <= 128 && Array.isArray(p.projects) && p.projects.length <= 256);
    const projects = p.projects.map((project: unknown) => {
      ensure(isRecord(project) && text(project.id) && text(project.name, 128) && typeof project.enabled === "boolean");
      return { id: project.id, name: project.name, enabled: project.enabled };
    });
    return { id: p.id, version: p.version, ...(p.name !== undefined && { name: p.name }), ...(p.description !== undefined && { description: p.description }), candidates: p.candidates.map(candidate), projects };
  });
  const choices = v.model_choices.map((c: unknown): ModelChoice => {
    ensure(isRecord(c) && text(c.provider) && text(c.model) && text(c.reasoning_configuration_reference) && text(c.reasoning) && text(c.harness));
    ensure(c.preference_only === undefined || typeof c.preference_only === "boolean");
    ensure(c.options === undefined || isRecord(c.options));
    ensure(c.source === undefined || text(c.source));
    ensure(c.observed_at === undefined || text(c.observed_at));
    return { provider: c.provider, model: c.model, reasoning_configuration_reference: c.reasoning_configuration_reference, reasoning: c.reasoning, harness: c.harness, preference_only: c.preference_only as boolean | undefined, options: c.options as Record<string, unknown> | undefined, source: c.source as string | undefined, observed_at: c.observed_at as string | undefined };
  });
  return { revision: v.revision, active_digest: v.active_digest, profiles, model_choices: choices };
}
function saved(v: unknown, operation: string): IntelligenceSaved {
  ensure(isRecord(v) && v.operation_id === operation && ["saved", "unchanged"].includes(String(v.disposition))
    && revision(v.revision) && digest(v.active_digest) && Array.isArray(v.updated_projects));
  for (const p of v.updated_projects) ensure(isRecord(p) && text(p.id) && text(p.name) && revision(p.revision));
  ensure(isRecord(v.profile) && text(v.profile.id) && typeof v.profile.version === "number" && Array.isArray(v.profile.candidates));
  v.profile.candidates.forEach(candidate);
  return v as unknown as IntelligenceSaved;
}
export async function readIntelligence(signal?: AbortSignal) {
  return adaptIntelligenceSettings(await apiGet<unknown>("/api/settings/intelligence", signal));
}
export async function saveIntelligence(request: SaveIntelligence) {
  return saved(await apiSend<unknown>("POST", "/api/settings/intelligence", request), request.operation_id);
}
export async function inspectIntelligenceSave(operation: string) {
  return saved(await apiGet<unknown>(`/api/settings/intelligence/operations/${encodeURIComponent(operation)}`), operation);
}
