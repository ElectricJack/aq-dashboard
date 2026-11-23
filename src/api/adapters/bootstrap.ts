import type { Bootstrap, Scope } from "../wire/proposed";
import { ContractError, isRecord } from "./contract";
import { UPGRADE_PATH } from "../../app/compatibility";

export type CapabilityState = { enabled: true } | { enabled: false; reason: string };
export type SupervisorStatus = Bootstrap["global_supervisor"]["status"] | "unsupported";

export type BootstrapView = {
  principal: { id: string; displayName: string; authorizationRevision: string };
  productVersion: string;
  dashboardDigest: string | null;
  compatibilityIssues: readonly string[];
  defaultScope: Scope;
  pageSize: number;
  globalSupervisor: { status: SupervisorStatus; conversationId: string | null };
  capability(name: string): CapabilityState;
};

const REVISION = /^[1-9][0-9]*$/;
const SUPERVISOR_STATUSES = new Set<string>(["available", "unconfigured", "unavailable"]);

function stringFields(value: unknown, ...names: string[]): value is Record<string, unknown> {
  return isRecord(value) && names.every(name => typeof value[name] === "string");
}

function validProduct(value: unknown): boolean {
  return stringFields(value, "version") && (value.dashboard_digest === null || typeof value.dashboard_digest === "string");
}

function validScope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.kind === "all_authorized" || (value.kind === "project" && typeof value.project_id === "string");
}

function validSupervisor(value: unknown): boolean {
  return stringFields(value, "status") && (value.conversation_id === null || typeof value.conversation_id === "string");
}

function validCapability(value: unknown): boolean {
  return stringFields(value, "name", "version") && typeof value.enabled === "boolean"
    && (value.reason === undefined || typeof value.reason === "string");
}

function validLimits(value: unknown): boolean {
  return isRecord(value) && typeof value.page_size === "number" && Number.isSafeInteger(value.page_size) && value.page_size >= 1;
}

const fields: Record<keyof Bootstrap, (value: unknown) => boolean> = {
  principal: value => stringFields(value, "id", "display_name"),
  product: validProduct,
  contracts: value => Array.isArray(value) && value.every(c => stringFields(c, "name", "version", "digest")),
  capabilities: value => Array.isArray(value) && value.every(validCapability),
  limits: validLimits,
  default_scope: validScope,
  global_supervisor: validSupervisor,
};

function validateShape(raw: unknown): void {
  // HTTP JSON is untrusted even when its caller supplies a TypeScript type.
  if (!isRecord(raw) || !Object.entries(fields).every(([key, valid]) => valid(raw[key]))) {
    throw new ContractError("Invalid bootstrap shape");
  }
}

function capabilityState(cap: Bootstrap["capabilities"][number] | undefined, missing: readonly string[]): CapabilityState {
  if (missing.length) return { enabled: false, reason: `This feature requires ${missing.join(", ")}. ${UPGRADE_PATH}` };
  if (!cap) return { enabled: false, reason: "Not offered by this AQ server" };
  if (cap.version !== "1") return { enabled: false, reason: "This capability version is not supported by the dashboard" };
  if (cap.enabled) return { enabled: true };
  return { enabled: false, reason: cap.reason ?? "Disabled by this AQ server" };
}

export function adaptBootstrap(raw: Bootstrap, requirements: { required_api_versions: readonly string[]; required_capabilities: readonly string[] } = { required_api_versions: [], required_capabilities: [] }): BootstrapView {
  validateShape(raw);
  if (new Set(raw.capabilities.map((cap) => cap.name)).size !== raw.capabilities.length) {
    throw new ContractError("Duplicate capability names");
  }
  const revision: unknown = raw.principal.authorization_revision;
  if (typeof revision !== "string" || !REVISION.test(revision)) {
    throw new ContractError("authorization_revision must be a positive decimal string");
  }
  const capabilities = new Map(raw.capabilities.map((c) => [c.name, c]));
  const missingContracts = requirements.required_api_versions.filter(version => !raw.contracts.some(contract => contract.version === version));
  const unsupportedCapabilities = requirements.required_capabilities.filter(name => capabilities.get(name)?.version !== "1");
  const status = raw.global_supervisor.status;
  return {
    principal: {
      id: raw.principal.id,
      displayName: raw.principal.display_name,
      authorizationRevision: revision,
    },
    productVersion: raw.product.version,
    dashboardDigest: raw.product.dashboard_digest,
    compatibilityIssues: [...missingContracts, ...unsupportedCapabilities],
    defaultScope: raw.default_scope,
    pageSize: raw.limits.page_size,
    globalSupervisor: {
      status: SUPERVISOR_STATUSES.has(status) ? status : "unsupported",
      conversationId: raw.global_supervisor.conversation_id,
    },
    capability: name => capabilityState(capabilities.get(name), missingContracts),
  };
}
