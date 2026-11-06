import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { adaptBootstrap, type BootstrapView } from "../api/adapters/bootstrap";
import { ContractError, isRecord } from "../api/adapters/contract";
import { ApiError, apiGet, isAccessRefusal, isAuthenticationFailure, isProtectedReadFailure } from "../api/client";
import type { QueryContext } from "../api/queryKeys";
import { readRetryDelay, shouldRetryRead } from "../api/retry";
import type { Bootstrap, Envelope } from "../api/wire/proposed";
import styles from "./Shell.module.css";
import { activateDrafts, clearDrafts, draftIdentity } from "./drafts";
import requirements from "./bundle-requirements.json";
import { blockIncompatibleFeatures, capabilitiesForResource } from "./compatibility";

/** Whether the most recent bootstrap refresh reached AQ with a valid sign-in. */
export type Connection = "connected" | "unreachable" | "signed_out";

export type Session = {
  bootstrap: BootstrapView;
  queryContext: QueryContext;
  connection: Connection;
  updateAvailable: boolean;
  reportIncompatible(capability: string): void;
  /**
   * Report a 401/403 from an action or a feature-local read. A 401 signs the
   * dashboard out (drafts cleared). A 403 stays with the caller, which keeps
   * its draft and explains the refusal; the session only re-reads bootstrap to
   * learn whether access itself changed.
   */
  reportAccessDenied(error: ApiError): void;
};

const SessionContext = createContext<Session | null>(null);
const NO_BLOCKED_FEATURES = new Set<string>();

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

async function fetchBootstrap(signal: AbortSignal): Promise<Pick<Session, "bootstrap" | "queryContext">> {
  const env = await apiGet<Envelope<Bootstrap>>("/api/v1/bootstrap", signal);
  if (!isRecord(env)) throw new ContractError("Invalid bootstrap envelope");
  const mockContract = (import.meta.env.MODE === "mock" || import.meta.env.MODE === "test") && env.api_version === "proposed-0";
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

/**
 * Re-read bootstrap under the app's read retry policy (WDR-02). The bootstrap
 * query itself never retries, so its 30 s poll reports an outage promptly; but
 * a re-check that decides whether to fail the whole app closed must not
 * conclude from one transient 429/503. It retries what the query client's
 * default policy retries (`readRetry` in App.tsx), with its backoff, and
 * resolves with the final bootstrap state.
 */
async function recheckBootstrap(client: QueryClient) {
  const defaults = client.getDefaultOptions().queries;
  const retry = (defaults?.retry ?? shouldRetryRead) as RetryOption;
  const delay = (defaults?.retryDelay ?? readRetryDelay) as RetryDelayOption;
  for (let failures = 0; ; failures++) {
    await client.refetchQueries({ queryKey: ["bootstrap"], exact: true });
    const state = client.getQueryState<unknown, Error>(["bootstrap"]);
    if (state?.status !== "error" || isProtectedReadFailure(state.error)) return state;
    // Same semantics as TanStack's retryer: the count of failures so far, starting at 0.
    const again = retry === true || (typeof retry === "number" && failures < retry) || (typeof retry === "function" && retry(failures, state.error));
    if (!again) return state;
    const wait = typeof delay === "function" ? delay(failures, state.error) : delay;
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

function GateTitle({ title }: { title: string }) {
  useLayoutEffect(() => {
    document.title = `${title} — Agent Q`;
    return () => { document.title = "Agent Q"; };
  }, [title]);
  return null;
}

/** Blocks the app until AQ identifies the principal and its capabilities. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const initialDigest = useRef<{ value: string | null } | null>(null);
  const [featureFailures, setFeatureFailures] = useState<{ identity: string; capabilities: Set<string> }>({ identity: "", capabilities: new Set() });
  // Only authentication (401), a failed bootstrap or the contract integrity
  // fence may take over the shell (QA §2A). A 403 or a missing item on one
  // read or action stays in the view that asked: a refused resource's retained
  // data is dropped and bootstrap is re-read to learn whether access changed.
  // A bootstrap 401/403 is the genuine sign-in/access failure and gates the
  // app; a new identity or authorization revision purges other caches below.
  // The 401 latch survives an unchanged bootstrap so a denied resource cannot
  // reopen in a request/remount loop.
  const [resourceFailure, setResourceFailure] = useState<Error | null>(null);
  const verifying = useRef<Promise<unknown> | null>(null);
  const verifyAccess = useRef<(error: Error) => void>(() => {});
  verifyAccess.current = (error: Error) => {
    if (verifying.current) return;
    verifying.current = recheckBootstrap(client).then((state) => {
      // Unable to confirm access after a refusal: fail closed until bootstrap answers.
      if (state?.status === "error" && !isProtectedReadFailure(state.error)) setResourceFailure(error);
    }).finally(() => { verifying.current = null; });
  };
  useLayoutEffect(() => client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "error" || event.query.queryKey[0] !== "aq") return;
    const error = event.query.state.error;
    if (error instanceof ApiError && error.status === 426) {
      const identity = JSON.stringify([event.query.queryKey[1], event.query.queryKey[2]]);
      const capabilities = capabilitiesForResource(String(event.query.queryKey[4]));
      setFeatureFailures(previous => ({ identity, capabilities: new Set([...(previous.identity === identity ? previous.capabilities : []), ...capabilities]) }));
      // The failed feature cannot retain previously successful content.
      event.query.setState({ data: undefined, dataUpdatedAt: 0 });
      return;
    }
    if (isAccessRefusal(error)) {
      // Never keep private stale content of a refused resource. A query seeded
      // with initialData belongs to a view that always has data; it shows the refusal itself.
      if (event.query.options.initialData === undefined) event.query.setState({ data: undefined, dataUpdatedAt: 0 });
      verifyAccess.current(error);
      return;
    }
    // Sign-in loss, and the global integrity fence for a response this bundle cannot trust.
    if (isProtectedReadFailure(error)) setResourceFailure(error);
  }), [client]);
  const query = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => fetchBootstrap(signal),
    refetchInterval: 30_000,
    retry: false,
  });

  const failure = isProtectedReadFailure(query.error) ? query.error : resourceFailure ?? query.error;
  const unauthenticated = failure instanceof ApiError && failure.status === 401;
  const incompatible = failure instanceof ContractError || (failure instanceof ApiError && (failure.kind === "contract" || [404, 426].includes(failure.status ?? 0)));
  const forbidden = failure instanceof ApiError && failure.status === 403;
  // A refusal whose bootstrap re-check could not reach AQ: the app is held
  // closed, but nothing proves a sign-out, so drafts are kept for this identity.
  const unconfirmed = forbidden && failure === resourceFailure;
  const context = query.data?.queryContext;
  const identity = context && draftIdentity(context);
  const blocked = featureFailures.identity === identity ? featureFailures.capabilities : NO_BLOCKED_FEATURES;
  const reportIncompatible = (capability: string) => {
    if (identity) setFeatureFailures(previous => ({ identity, capabilities: new Set([...(previous.identity === identity ? previous.capabilities : []), capability]) }));
  };
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (unauthenticated || (forbidden && !unconfirmed)) { clearDrafts(); setDraftOwner(null); }
    else if (unconfirmed) setDraftOwner(null);
    else if (identity) { activateDrafts(identity); setDraftOwner(identity); }
  }, [identity, unauthenticated, forbidden, unconfirmed]);
  if (query.data && initialDigest.current === null) initialDigest.current = { value: query.data.bootstrap.dashboardDigest };
  useLayoutEffect(() => {
    // A role/identity/API change must not keep another authorization scope's
    // protected data in the browser cache. Bootstrap itself stays for recovery.
    const obsolete = (key: readonly unknown[]) => key[0] === "aq" && (
      unauthenticated || forbidden || incompatible || !context ||
      capabilitiesForResource(String(key[4])).some(capability => blocked.has(capability)) ||
      key[1] !== context.principalId || key[2] !== context.authorizationRevision || key[3] !== context.contractVersion
    );
    void client.cancelQueries({ predicate: (q) => obsolete(q.queryKey) });
    client.removeQueries({ predicate: (q) => obsolete(q.queryKey) });
  }, [client, context, unauthenticated, forbidden, incompatible, blocked]);
  if (query.data && !unauthenticated && !forbidden && !incompatible) {
    const connection: Connection = !query.isError
      ? "connected"
      : unauthenticated
        ? "signed_out"
        : "unreachable";
    return (
      <SessionContext.Provider value={{ ...query.data, bootstrap: blockIncompatibleFeatures(query.data.bootstrap, blocked), connection, reportIncompatible, reportAccessDenied: error => { if (isAuthenticationFailure(error)) { clearDrafts(); setResourceFailure(error); } else verifyAccess.current(error); }, updateAvailable: !!initialDigest.current?.value && !!query.data.bootstrap.dashboardDigest && initialDigest.current.value !== query.data.bootstrap.dashboardDigest }}>{draftOwner === identity ? children : null}</SessionContext.Provider>
    );
  }
  if (failure) {
    const heading = unauthenticated ? "Sign in required" : unconfirmed ? "Access not confirmed" : forbidden ? "Access denied" : incompatible ? "Dashboard update required" : "Can't reach AQ";
    return (
      <main className={styles.gate}>
        <GateTitle title={heading} />
        <p className={styles.brand}>Agent Q</p>
        <h1>{heading}</h1>
        <p>
          {unauthenticated
            ? "Sign in through AQ, then reload this page."
            : unconfirmed
              ? "AQ refused a request and the dashboard could not re-check your access, because AQ did not respond. Your drafts are kept. Try again when AQ is reachable."
            : forbidden
              ? "Your account does not have access to this dashboard. Ask an AQ administrator for access, then try again."
              : incompatible
                ? "This dashboard and AQ server do not support the same API. Install compatible versions, then reload."
                : "The dashboard could not load your identity and capabilities from AQ."}
        </p>
        {!unauthenticated && (
          <button type="button" className={styles.button} onClick={() => {
            void recheckBootstrap(client).then((state) => {
              if (state?.status === "success") setResourceFailure(null);
            });
          }}>
            Try again
          </button>
        )}
      </main>
    );
  }
  return (
    <main className={styles.gate} aria-busy="true">
      <p className={styles.brand}>Agent Q</p>
      <p>Connecting to AQ…</p>
    </main>
  );
}
