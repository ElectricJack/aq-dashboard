import { apiGet, apiSend, ApiError } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { readPlaybookSource, type SourceView } from "./playbookSources";

/** The routing switch (spec 0013 §7) and the routing playbook source it depends on. */
export const ROUTING_POLICY_PATH = "/api/settings/intelligence/routing";
/** The id of the routing document's playbook source, and the playbook id it is bound to (plan, Global Constraints). */
export const ROUTING_SOURCE_ID = "routing";
export const ROUTING_BINDING = "aq.routing";
export type RoutingPolicyState = { enabled: boolean; source: SourceView };

/** The switch endpoint still answers `active` and `latest` (always null after D1); only `enabled` is read. */
export function adaptRoutingSwitch(value: unknown): boolean {
  if (!isRecord(value) || typeof value.enabled !== "boolean") throw new ContractError("Invalid routing switch response");
  return value.enabled;
}
/** Before the routing document has been saved once, there is no source to read (A6): that is "no playbook yet", not an error. */
const NO_SOURCE: SourceView = { id: ROUTING_SOURCE_ID, kind: "builtin", binding: ROUTING_BINDING, active: null, latest: null };
export async function readRoutingSource(signal?: AbortSignal): Promise<SourceView> {
  try { return await readPlaybookSource(ROUTING_SOURCE_ID, signal); } catch (error) {
    if (error instanceof ApiError && error.status === 404) return NO_SOURCE;
    throw error;
  }
}
export async function readRoutingPolicy(signal?: AbortSignal): Promise<RoutingPolicyState> {
  const [enabled, source] = await Promise.all([apiGet<unknown>(ROUTING_POLICY_PATH, signal).then(adaptRoutingSwitch), readRoutingSource(signal)]);
  return { enabled, source };
}
/** Turns routing on (the server refuses with 409 and its own words until a playbook is active) or off. */
export async function setRouting(enabled: boolean): Promise<boolean> { return adaptRoutingSwitch(await apiSend<unknown>("POST", ROUTING_POLICY_PATH, { enabled })); }
