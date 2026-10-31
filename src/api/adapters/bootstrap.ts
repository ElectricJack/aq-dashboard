import type { Bootstrap, Scope } from "../wire/proposed";
import { ContractError, isRecord } from "./contract";

export type CapabilityState = { enabled: true } | { enabled: false; reason: string };
export type SupervisorStatus = Bootstrap["global_supervisor"]["status"] | "unsupported";

export type BootstrapView = {
  principal: { id: string; displayName: string; authorizationRevision: string };
  productVersion: string;
  defaultScope: Scope;
  pageSize: number;
  globalSupervisor: { status: SupervisorStatus; conversationId: string | null };
  capability(name: string): CapabilityState;
};

const REVISION = /^[1-9][0-9]*$/;
const SUPERVISOR_STATUSES = new Set<string>(["available", "unconfigured", "unavailable"]);

export function adaptBootstrap(raw: Bootstrap): BootstrapView {
  // HTTP JSON is untrusted even when its caller supplies a TypeScript type.
  if (!isRecord(raw) || !isRecord(raw.principal) ||
      typeof raw.principal.id !== "string" || typeof raw.principal.display_name !== "string" ||
      !isRecord(raw.product) || typeof raw.product.version !== "string" ||
      !isRecord(raw.limits) || !Number.isSafeInteger(raw.limits.page_size) || raw.limits.page_size < 1 ||
      !isRecord(raw.default_scope) || !(raw.default_scope.kind === "all_authorized" ||
        (raw.default_scope.kind === "project" && typeof raw.default_scope.project_id === "string")) ||
      !isRecord(raw.global_supervisor) || typeof raw.global_supervisor.status !== "string" ||
      !(raw.global_supervisor.conversation_id === null || typeof raw.global_supervisor.conversation_id === "string") ||
      !Array.isArray(raw.capabilities) || raw.capabilities.some((cap: unknown) =>
        !isRecord(cap) || typeof cap.name !== "string" || typeof cap.version !== "string" ||
        typeof cap.enabled !== "boolean" || !(cap.reason === undefined || typeof cap.reason === "string"))) {
    throw new ContractError("Invalid bootstrap shape");
  }
  if (new Set(raw.capabilities.map((cap) => cap.name)).size !== raw.capabilities.length) {
    throw new ContractError("Duplicate capability names");
  }
  const revision: unknown = raw.principal.authorization_revision;
  if (typeof revision !== "string" || !REVISION.test(revision)) {
    throw new ContractError("authorization_revision must be a positive decimal string");
  }
  const capabilities = new Map(raw.capabilities.map((c) => [c.name, c]));
  const status = raw.global_supervisor.status;
  return {
    principal: {
      id: raw.principal.id,
      displayName: raw.principal.display_name,
      authorizationRevision: revision,
    },
    productVersion: raw.product.version,
    defaultScope: raw.default_scope,
    pageSize: raw.limits.page_size,
    globalSupervisor: {
      status: SUPERVISOR_STATUSES.has(status) ? status : "unsupported",
      conversationId: raw.global_supervisor.conversation_id,
    },
    capability(name) {
      const cap = capabilities.get(name);
      if (!cap) return { enabled: false, reason: "Not offered by this AQ server" };
      if (cap.version !== "1") return { enabled: false, reason: "This capability version is not supported by the dashboard" };
      if (cap.enabled === true) return { enabled: true };
      return { enabled: false, reason: cap.reason ?? "Disabled by this AQ server" };
    },
  };
}
