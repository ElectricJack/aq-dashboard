import type { Bootstrap, Scope } from "../wire/proposed";
import { ContractError } from "./contract";

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
      if (cap.enabled) return { enabled: true };
      return { enabled: false, reason: cap.reason ?? "Disabled by this AQ server" };
    },
  };
}
