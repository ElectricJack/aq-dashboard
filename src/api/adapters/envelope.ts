import type { Envelope, Scope } from "../wire/proposed";
import { ContractError, isRecord } from "./contract";

function matchesScope(actual: unknown, expected: Scope): boolean {
  if (!isRecord(actual) || actual.kind !== expected.kind) return false;
  return expected.kind !== "project" || actual.project_id === expected.project_id;
}

function hasEnvelopeFields(env: Envelope<unknown>): boolean {
  const hasData = "data" in env && env.data != null;
  const dated = typeof env.server_time === "string" && Number.isFinite(Date.parse(env.server_time));
  const covered = isRecord(env.coverage) && ["complete", "partial", "unknown"].includes(env.coverage.state);
  return hasData && dated && covered;
}

/** Check routing context before adapting or caching any protected response. */
export function validateReadEnvelope(env: Envelope<unknown>, version: string, scope: Scope = { kind: "all_authorized" }): void {
  const versionMatches = isRecord(env) && env.api_version === version;
  if (!versionMatches || !matchesScope(env.scope, scope)) {
    throw new ContractError("Read response version or scope does not match the request");
  }
  if (!hasEnvelopeFields(env)) throw new ContractError("Read response is missing required envelope fields");
}
