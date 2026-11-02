import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { adaptBootstrap, type BootstrapView } from "../api/adapters/bootstrap";
import { ContractError, isRecord } from "../api/adapters/contract";
import { ApiError, apiGet, isProtectedReadFailure } from "../api/client";
import type { QueryContext } from "../api/queryKeys";
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

/** Blocks the app until AQ identifies the principal and its capabilities. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const initialDigest = useRef<{ value: string | null } | null>(null);
  const [featureFailures, setFeatureFailures] = useState<{ identity: string; capabilities: Set<string> }>({ identity: "", capabilities: new Set() });
  // A protected read can revoke authority before bootstrap's next refresh.
  // Latch the failure until explicit recovery, so an unchanged bootstrap cannot
  // reopen a denied resource in a repeated request/remount loop.
  const [resourceFailure, setResourceFailure] = useState<Error | null>(null);
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
    if (isProtectedReadFailure(error)) {
      setResourceFailure(error);
    }
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
  const context = query.data?.queryContext;
  const identity = context && draftIdentity(context);
  const blocked = featureFailures.identity === identity ? featureFailures.capabilities : NO_BLOCKED_FEATURES;
  const reportIncompatible = (capability: string) => {
    if (identity) setFeatureFailures(previous => ({ identity, capabilities: new Set([...(previous.identity === identity ? previous.capabilities : []), capability]) }));
  };
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (unauthenticated || forbidden) { clearDrafts(); setDraftOwner(null); }
    else if (identity) { activateDrafts(identity); setDraftOwner(identity); }
  }, [identity, unauthenticated, forbidden]);
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
      <SessionContext.Provider value={{ ...query.data, bootstrap: blockIncompatibleFeatures(query.data.bootstrap, blocked), connection, reportIncompatible, reportAccessDenied: error => { clearDrafts(); setResourceFailure(error); }, updateAvailable: !!initialDigest.current?.value && !!query.data.bootstrap.dashboardDigest && initialDigest.current.value !== query.data.bootstrap.dashboardDigest }}>{draftOwner === identity ? children : null}</SessionContext.Provider>
    );
  }
  if (failure) {
    return (
      <main className={styles.gate}>
        <p className={styles.brand}>Agent Q</p>
        <h1>{unauthenticated ? "Sign in required" : forbidden ? "Access denied" : incompatible ? "Dashboard update required" : "Can't reach AQ"}</h1>
        <p>
          {unauthenticated
            ? "Sign in through AQ, then reload this page."
            : forbidden
              ? "Access to this dashboard or a requested resource was denied."
              : incompatible
                ? "This dashboard and AQ server do not support the same API. Install compatible versions, then reload."
                : "The dashboard could not load your identity and capabilities from AQ."}
        </p>
        {!unauthenticated && (
          <button type="button" className={styles.button} onClick={() => {
            void query.refetch().then((result) => {
              if (result.isSuccess) setResourceFailure(null);
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
