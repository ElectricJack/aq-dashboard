import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { adaptBootstrap, type BootstrapView } from "../api/adapters/bootstrap";
import { ApiError, apiGet } from "../api/client";
import type { QueryContext } from "../api/queryKeys";
import type { Bootstrap, Envelope } from "../api/wire/proposed";
import styles from "./Shell.module.css";

/** Whether the most recent bootstrap refresh reached AQ with a valid sign-in. */
export type Connection = "connected" | "unreachable" | "signed_out";

export type Session = {
  bootstrap: BootstrapView;
  queryContext: QueryContext;
  connection: Connection;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

async function fetchBootstrap(signal: AbortSignal): Promise<Omit<Session, "connection">> {
  const env = await apiGet<Envelope<Bootstrap>>("/api/v1/bootstrap", signal);
  const mockContract = (import.meta.env.MODE === "mock" || import.meta.env.MODE === "test") && env.api_version === "proposed-0";
  if (env.api_version !== "dashboard-read-1" && !mockContract) {
    throw new ApiError("contract", "This AQ dashboard API version is not supported");
  }
  const bootstrap = adaptBootstrap(env.data);
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
  const query = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => fetchBootstrap(signal),
    refetchInterval: 30_000,
    retry: false,
  });

  const unauthenticated = query.error instanceof ApiError && query.error.status === 401;
  const incompatible = query.error instanceof ApiError && (query.error.kind === "contract" || [404, 426].includes(query.error.status ?? 0));
  const forbidden = query.error instanceof ApiError && query.error.status === 403;
  const context = query.data?.queryContext;
  useEffect(() => {
    // A role/identity/API change must not keep another authorization scope's
    // protected data in the browser cache. Bootstrap itself stays for recovery.
    const obsolete = (key: readonly unknown[]) => key[0] === "aq" && (
      unauthenticated || forbidden || incompatible || !context ||
      key[1] !== context.principalId || key[2] !== context.authorizationRevision || key[3] !== context.contractVersion
    );
    void client.cancelQueries({ predicate: (q) => obsolete(q.queryKey) });
    client.removeQueries({ predicate: (q) => obsolete(q.queryKey) });
  }, [client, context, unauthenticated, forbidden, incompatible]);
  if (query.data && !unauthenticated && !forbidden && !incompatible) {
    const connection: Connection = !query.isError
      ? "connected"
      : unauthenticated
        ? "signed_out"
        : "unreachable";
    return (
      <SessionContext.Provider value={{ ...query.data, connection }}>{children}</SessionContext.Provider>
    );
  }
  if (query.isError) {
    return (
      <main className={styles.gate}>
        <p className={styles.brand}>Agent Q</p>
        <h1>{unauthenticated ? "Sign in required" : forbidden ? "Access denied" : incompatible ? "Dashboard update required" : "Can't reach AQ"}</h1>
        <p>
          {unauthenticated
            ? "Sign in through AQ, then reload this page."
            : forbidden
              ? "Your account does not have access to this AQ installation."
              : incompatible
                ? "This dashboard and AQ server do not support the same API. Install compatible versions, then reload."
                : "The dashboard could not load your identity and capabilities from AQ."}
        </p>
        {!unauthenticated && (
          <button type="button" className={styles.button} onClick={() => void query.refetch()}>
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
