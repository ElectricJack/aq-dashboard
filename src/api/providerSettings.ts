import { useQuery } from "@tanstack/react-query";
import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { queryKey } from "./queryKeys";
import { useSession } from "../app/session";
export type Provider = { id: string; name: string; accounts: string[]; credential_status: "present" | "missing" | "disabled" | "not_configured" };
/** `codex_login_max_age_days`: the owner's limit on how long ago a saved Codex login may have been refreshed when AQ leases it to an agent; null is no limit. A server that predates the setting omits it. */
export type ProviderSettings = { revision: string; available_revision: string; providers: string[]; available: Provider[]; codex_login_max_age_days?: number | null };
/** `codex_login_max_age_days` is sent only when it changes: absent keeps the stored limit, null removes it. */
export type SaveProviders = { operation_id: string; expected_revision: string; expected_available_revision: string; providers: string[]; codex_login_max_age_days?: number | null };
export const validLoginAge = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3650);
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid provider settings response"); }
const label = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value);
const unique = (values: string[]) => new Set(values).size === values.length;
export function adaptProviderSettings(raw: unknown): ProviderSettings {
  ensure(isRecord(raw) && typeof raw.revision === "string" && /^(0|[1-9]\d*)$/.test(raw.revision) && raw.revision.length <= 32 && typeof raw.available_revision === "string" && /^[a-f0-9]{64}$/.test(raw.available_revision));
  ensure(Array.isArray(raw.providers) && raw.providers.length <= 32 && raw.providers.every(label) && unique(raw.providers));
  ensure(Array.isArray(raw.available) && raw.available.length <= 64);
  ensure(raw.codex_login_max_age_days === undefined || validLoginAge(raw.codex_login_max_age_days));
  const ids: string[] = [];
  for (const row of raw.available) {
    ensure(isRecord(row) && label(row.id) && label(row.name) && ["present", "missing", "disabled", "not_configured"].includes(String(row.credential_status)) && Array.isArray(row.accounts) && row.accounts.length <= 32 && row.accounts.every(label) && unique(row.accounts));
    ids.push(row.id);
  }
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
