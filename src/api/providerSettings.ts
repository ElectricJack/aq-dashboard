import { useQuery } from "@tanstack/react-query";
import { apiGet, apiSend } from "./client";
import { ContractError, isRecord, boundedList } from "./adapters/contract";
import { queryKey } from "./queryKeys";
import { useSession } from "../app/session";
/** `attention`: what the owner must do before this provider's agents can start again (a saved Codex login past the age limit); AQ routes around the provider meanwhile. */
export type Provider = { id: string; name: string; accounts: string[]; credential_status: "present" | "missing" | "disabled" | "not_configured"; attention?: string };
/** `codex_login_max_age_days`: the owner's limit on how long ago a saved Codex login may have been refreshed when AQ leases it to an agent; null is no limit. A server that predates the setting omits it. */
export type ProviderSettings = { revision: string; available_revision: string; providers: string[]; available: Provider[]; codex_login_max_age_days?: number | null };
/** `codex_login_max_age_days` is sent only when it changes: absent keeps the stored limit, null removes it. */
export type SaveProviders = { operation_id: string; expected_revision: string; expected_available_revision: string; providers: string[]; codex_login_max_age_days?: number | null };
export const validLoginAge = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650);
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid provider settings response"); }
const label = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value);
const unique = (values: unknown[]) => new Set(values).size === values.length;
function labels(value: unknown): boolean {
  return boundedList(value, 32, label) && unique(value);
}

function providerId(row: unknown): string {
  ensure(isRecord(row));
  ensure(label(row.id));
  ensure(label(row.name));
  ensure(["present", "missing", "disabled", "not_configured"].includes(String(row.credential_status)));
  ensure(Array.isArray(row.accounts));
  ensure(row.accounts.length <= 32 && row.accounts.every(label) && unique(row.accounts));
  ensure((row.attention === undefined || label(row.attention)));
  return row.id;
}
export function adaptProviderSettings(raw: unknown): ProviderSettings {
  ensure(isRecord(raw));
  ensure(typeof raw.revision === "string" && /^(0|[1-9]\d*)$/.test(raw.revision) && raw.revision.length <= 32);
  ensure(typeof raw.available_revision === "string" && /^[a-f0-9]{64}$/.test(raw.available_revision));
  ensure(labels(raw.providers));
  ensure(Array.isArray(raw.available) && raw.available.length <= 64);
  ensure(raw.codex_login_max_age_days === undefined || validLoginAge(raw.codex_login_max_age_days));
  const ids = raw.available.map(providerId);
  ensure(unique(ids)); return raw as ProviderSettings;
}
export async function readProviderSettings(signal?: AbortSignal) { return adaptProviderSettings(await apiGet<unknown>("/api/settings/providers", signal)); }
function receipt(raw: unknown, id: string) { ensure(isRecord(raw) && raw.operation_id === id); return adaptProviderSettings(raw); }
export async function saveProviderSettings(request: SaveProviders) { return receipt(await apiSend<unknown>("POST", "/api/settings/providers", request), request.operation_id); }
export async function inspectProviderSave(id: string) { return receipt(await apiGet<unknown>(`/api/settings/providers/operations/${encodeURIComponent(id)}`), id); }
export function useProviderSettings(enabled = true) {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, "provider-settings", {}), queryFn: ({ signal }) => readProviderSettings(signal), retry: false, enabled });
}
