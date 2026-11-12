import { useQuery } from "@tanstack/react-query";
import { apiGet, apiSend } from "./client";
import { ContractError, isRecord } from "./adapters/contract";
import { queryKey } from "./queryKeys";
import { useSession } from "../app/session";
export type Provider = { id: string; name: string; accounts: string[]; credential_status: "present" | "missing" | "disabled" };
export type ProviderSettings = { revision: string; available_revision: string; providers: string[]; available: Provider[] };
export type SaveProviders = { operation_id: string; expected_revision: string; expected_available_revision: string; providers: string[] };
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid provider settings response"); }
const label = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value);
const unique = (values: string[]) => new Set(values).size === values.length;
export function adaptProviderSettings(raw: unknown): ProviderSettings {
  ensure(isRecord(raw) && typeof raw.revision === "string" && /^(0|[1-9]\d*)$/.test(raw.revision) && raw.revision.length <= 32 && typeof raw.available_revision === "string" && /^[a-f0-9]{64}$/.test(raw.available_revision));
  ensure(Array.isArray(raw.providers) && raw.providers.length <= 32 && raw.providers.every(label) && unique(raw.providers));
  ensure(Array.isArray(raw.available) && raw.available.length <= 32);
  const ids: string[] = [];
  for (const row of raw.available) {
    ensure(isRecord(row) && label(row.id) && label(row.name) && ["present", "missing", "disabled"].includes(String(row.credential_status)) && Array.isArray(row.accounts) && row.accounts.length <= 32 && row.accounts.every(label) && unique(row.accounts));
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
