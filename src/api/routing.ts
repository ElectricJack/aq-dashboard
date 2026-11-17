import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { adaptSourceView, readPlaybookSource, sourceGap, type SourceGap, type SourceView } from "./playbookSources";

/** The routing switch (spec 0013 §7) and the routing playbook source it depends on. */
export const ROUTING_POLICY_PATH = "/api/settings/routing";
/** The id of the routing document's playbook source. */
export const ROUTING_SOURCE_ID = "routing";
/** `source` is null when the server has none to show; `gap` then says why. */
export type RoutingPolicyState = { enabled: boolean; source: SourceView | null; gap: SourceGap | null };

/** The routing read and the switch answer `{enabled, source: SourceView | null}`; a server that does not fill `source` yet leaves it out. */
export function adaptRoutingPolicy(value: unknown): { enabled: boolean; source: SourceView | null } {
  if (!isRecord(value) || typeof value.enabled !== "boolean") throw new ContractError("Invalid routing switch response");
  return { enabled: value.enabled, source: value.source === null || value.source === undefined ? null : adaptSourceView(value.source) };
}
/**
 * The switch and the routing source. When the routing read carries no source, the source is read from the sources API,
 * so the page works against a server that does not fill it yet. No source (404) and no playbook engine (503) are states, not errors.
 */
export async function readRoutingPolicy(signal?: AbortSignal): Promise<RoutingPolicyState> {
  const policy = adaptRoutingPolicy(await apiGet<unknown>(ROUTING_POLICY_PATH, signal));
  if (policy.source) return { ...policy, gap: null };
  try { return { enabled: policy.enabled, source: await readPlaybookSource(ROUTING_SOURCE_ID, signal), gap: null }; } catch (error) {
    const gap = sourceGap(error);
    if (!gap) throw error;
    return { enabled: policy.enabled, source: null, gap };
  }
}
/** Turns routing on (the server refuses with 409 and its own words until a playbook is active) or off. */
export async function setRouting(enabled: boolean): Promise<boolean> { return adaptRoutingPolicy(await apiSend<unknown>("POST", ROUTING_POLICY_PATH, { enabled })).enabled; }
