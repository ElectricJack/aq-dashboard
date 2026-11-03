import { useQuery } from "@tanstack/react-query";
import {
  adaptProviderUsage,
  atServerTime,
  type ProviderUsageResult,
} from "../api/adapters/providerUsage";
import { ApiError, apiGet, isProtectedReadFailure } from "../api/client";
import { adaptConfiguredProviders } from "../api/adapters/configuredProviders";
import { queryKey } from "../api/queryKeys";
import type { ProviderUsageEnvelope } from "../api/wire/overview";
import { validateReadEnvelope } from "../api/adapters/envelope";
import type { ProviderUsageState } from "../components/ProviderUsageStrip/ProviderUsageStrip";
import { useServerNow } from "../components/time/useServerNow";
import { useSession } from "./session";

/** Initial budget from docs/plans/0001 section 2; subject to server limits. */
const QUOTA_POLL_MS = 60_000;
/** A hung request must not keep the last value looking current. */
const QUOTA_TIMEOUT_MS = 15_000;

function markStale(data: ProviderUsageResult): ProviderUsageResult {
  return {
    ...data,
    providers: data.providers.map((p) => ({
      ...p,
      windows: p.windows.map((w) => ({ ...w, freshness: "stale" as const })),
    })),
  };
}

export type ProviderUsageQuery = { state: ProviderUsageState; unreachable: boolean };

export function useProviderUsage(): ProviderUsageQuery {
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability("provider.quota");
  const configuredCapability = bootstrap.capability("providers.configured.read");
  const configured = useQuery({
    queryKey: queryKey(queryContext, "configured-provider-accounts", { contract: "human-provider-accounts-1" }),
    queryFn: async ({ signal }) => adaptConfiguredProviders(await apiGet<unknown>("/api/human/provider-accounts", AbortSignal.any([signal, AbortSignal.timeout(QUOTA_TIMEOUT_MS)]))),
    enabled: configuredCapability.enabled,
    retry: false,
    refetchInterval: QUOTA_POLL_MS,
  });
  const query = useQuery({
    queryKey: queryKey(queryContext, "provider-usage", {}),
    queryFn: async ({ signal }) => {
      const env = await apiGet<ProviderUsageEnvelope>(
        "/api/v1/provider-usage",
        AbortSignal.any([signal, AbortSignal.timeout(QUOTA_TIMEOUT_MS)]),
      );
      validateReadEnvelope(env, queryContext.contractVersion);
      return { result: adaptProviderUsage(env), receivedAt: performance.now() };
    },
    enabled: capability.enabled,
    refetchInterval: QUOTA_POLL_MS,
  });
  const now = useServerNow(
    query.data && { serverTime: query.data.result.serverTime, receivedAt: query.data.receivedAt },
  );
  const unreachable =
    (capability.enabled && query.isError && (!(query.error instanceof ApiError) || query.error.kind === "transport")) ||
    (configuredCapability.enabled && configured.isError && configured.error instanceof ApiError && configured.error.kind === "transport");
  const configuredState = (): ProviderUsageState => {
    if (configured.isError && isProtectedReadFailure(configured.error)) return { status: "configuration-error" };
    if (configured.data) return { status: "configured", data: configured.data, stale: configured.isError };
    return configured.isError ? { status: "configuration-error" } : { status: "loading" };
  };

  if (!capability.enabled) return { state: configuredCapability.enabled ? configuredState() : { status: "disabled", reason: capability.reason }, unreachable };
  if (query.isError && isProtectedReadFailure(query.error)) return { state: { status: "error" }, unreachable };
  if (query.data) {
    const current = now ? atServerTime(query.data.result, now) : query.data.result;
    // A failed refresh keeps the last values, but they are no longer current.
    return { state: { status: "ready", data: query.isError ? markStale(current) : current }, unreachable };
  }
  if (query.isError) return { state: configuredCapability.enabled ? configuredState() : { status: "error" }, unreachable };
  return { state: { status: "loading" }, unreachable };
}
