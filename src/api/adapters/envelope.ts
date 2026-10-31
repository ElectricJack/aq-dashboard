import type { Envelope, Scope } from "../wire/proposed";
import { ContractError, isRecord } from "./contract";

/** Check routing context before adapting or caching any protected response. */
export function validateReadEnvelope(env: Envelope<unknown>, version: string, scope: Scope = { kind: "all_authorized" }): void {
  if (!isRecord(env) || env.api_version !== version || !isRecord(env.scope) ||
      env.scope.kind !== scope.kind ||
      (scope.kind === "project" && (env.scope.kind !== "project" || env.scope.project_id !== scope.project_id))) {
    throw new ContractError("Read response version or scope does not match the request");
  }
  if (!("data" in env) || env.data === null || env.data === undefined ||
      typeof env.server_time !== "string" || !Number.isFinite(Date.parse(env.server_time)) ||
      !isRecord(env.coverage) || !["complete", "partial", "unknown"].includes(env.coverage.state)) {
    throw new ContractError("Read response is missing required envelope fields");
  }
}
