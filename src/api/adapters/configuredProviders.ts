import { ContractError, isRecord } from "./contract";
export type ConfiguredAccount = { provider: string; account_reference: string; enabled: boolean; provisionable: boolean; credential_profiles: number };
export type ConfiguredProviders = { schema_version: 1; contract: "human-provider-accounts-1"; source: "startup_configuration"; server_time_ms: number; revision: number | null; accounts: ConfiguredAccount[] };
function ensure(value: unknown): asserts value { if (!value) throw new ContractError("Invalid configured provider accounts"); }
function shape(value: unknown, fields: string): asserts value is Record<string, unknown> { ensure(isRecord(value)); const names = fields.split(" "); ensure(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))); }
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && typeof value === "number" && value > 0 && value <= maximum; }
function label(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value); }
export function adaptConfiguredProviders(raw: unknown): ConfiguredProviders {
  shape(raw, "schema_version contract source server_time_ms revision accounts");
  ensure(raw.schema_version === 1 && raw.contract === "human-provider-accounts-1" && raw.source === "startup_configuration" && integer(raw.server_time_ms) && (raw.revision === null || integer(raw.revision)) && Array.isArray(raw.accounts) && raw.accounts.length <= 32);
  let total = 0; const seen = new Set<string>();
  for (const account of raw.accounts) {
    shape(account, "provider account_reference enabled provisionable credential_profiles");
    ensure(label(account.provider) && label(account.account_reference) && typeof account.enabled === "boolean" && typeof account.provisionable === "boolean" && (!account.provisionable || account.enabled) && integer(account.credential_profiles, 32));
    const key = JSON.stringify([account.provider, account.account_reference]); ensure(!seen.has(key)); seen.add(key); total += account.credential_profiles;
  }
  ensure(total <= 32 && (raw.revision !== null || raw.accounts.length === 0));
  return raw as ConfiguredProviders;
}
export function configuredProviderLabel(account: ConfiguredAccount): string {
  return ({ openai: "OpenAI", anthropic: "Anthropic" } as Record<string, string>)[account.provider] ?? account.provider;
}
export function configuredAccountLabel(account: ConfiguredAccount): string {
  return `${configuredProviderLabel(account)} · ${account.account_reference}`;
}
export function configuredAccountStatus(account: ConfiguredAccount): string {
  return !account.enabled ? "Disabled" : account.provisionable ? "Enabled · server key present" : "Enabled · server key unavailable";
}
