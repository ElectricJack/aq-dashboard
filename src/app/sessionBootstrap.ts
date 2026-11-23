import type { QueryClient } from "@tanstack/react-query";
import { adaptBootstrap } from "../api/adapters/bootstrap";
import { ContractError, isRecord } from "../api/adapters/contract";
import { ApiError, apiGet, isProtectedReadFailure } from "../api/client";
import { readRetryDelay, shouldRetryRead } from "../api/retry";
import type { Bootstrap, Envelope } from "../api/wire/proposed";
import type { Session } from "./session";
import requirements from "./bundle-requirements.json";
function supportsMockContract(version: string) {
  const mode = import.meta.env.MODE;
  return (mode === "mock" || mode === "test") && version === "proposed-0";
}

export async function fetchBootstrap(
  signal: AbortSignal,
): Promise<Pick<Session, "bootstrap" | "queryContext">> {
  const env = await apiGet<Envelope<Bootstrap>>("/api/v1/bootstrap", signal);
  if (!isRecord(env)) throw new ContractError("Invalid bootstrap envelope");
  const mockContract = supportsMockContract(env.api_version);
  if (env.api_version !== "dashboard-read-1" && !mockContract) {
    throw new ApiError("contract", "This AQ dashboard API version is not supported");
  }
  const bootstrap = adaptBootstrap(env.data, mockContract ? undefined : requirements);
  return {
    bootstrap,
    queryContext: {
      principalId: bootstrap.principal.id,
      authorizationRevision: bootstrap.principal.authorizationRevision,
      contractVersion: env.api_version,
    },
  };
}

type RetryOption = boolean | number | ((failureCount: number, error: unknown) => boolean);
type RetryDelayOption = number | ((failureCount: number, error: unknown) => number);

function retryFailure(policy: RetryOption, failures: number, error: unknown) {
  if (typeof policy === "function") return policy(failures, error);
  if (typeof policy === "number") return failures < policy;
  return policy;
}
/**
 * Re-read bootstrap under the app's read retry policy (WDR-02). The bootstrap
 * query itself never retries, so its 30 s poll reports an outage promptly; but
 * a re-check that decides whether to fail the whole app closed must not
 * conclude from one transient 429/503. It retries what the query client's
 * default policy retries (`readRetry` in App.tsx), with its backoff, and
 * resolves with the final bootstrap state.
 */
function retryOptions(client: QueryClient) {
  const defaults = client.getDefaultOptions().queries;
  const retry = (defaults?.retry ?? shouldRetryRead) as RetryOption;
  const delay = (defaults?.retryDelay ?? readRetryDelay) as RetryDelayOption;
  return { retry, delay };
}
export async function recheckBootstrap(client: QueryClient) {
  const { retry, delay } = retryOptions(client);
  for (let failures = 0; ; failures++) {
    await client.refetchQueries({ queryKey: ["bootstrap"], exact: true });
    const state = client.getQueryState<unknown, Error>(["bootstrap"]);
    if (state?.status !== "error" || isProtectedReadFailure(state.error)) return state;
    // Same semantics as TanStack's retryer: the count of failures so far, starting at 0.
    if (!retryFailure(retry, failures, state.error)) return state;
    const wait = typeof delay === "function" ? delay(failures, state.error) : delay;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
