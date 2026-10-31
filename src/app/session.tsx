import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
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
  const query = useQuery({ queryKey: ["bootstrap"], queryFn: ({ signal }) => fetchBootstrap(signal) });

  const unauthenticated = query.error instanceof ApiError && query.error.status === 401;
  if (query.data) {
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
        <h1>{unauthenticated ? "Sign in required" : "Can't reach AQ"}</h1>
        <p>
          {unauthenticated
            ? "Sign in through AQ, then reload this page."
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
