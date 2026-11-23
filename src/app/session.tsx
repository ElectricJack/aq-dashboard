import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BootstrapView } from "../api/adapters/bootstrap";
import { ApiError, isProtectedReadFailure } from "../api/client";
import type { QueryContext } from "../api/queryKeys";
import { activateDrafts, clearDrafts, draftIdentity } from "./drafts";
import { blockIncompatibleFeatures } from "./compatibility";
import { SessionGate, Connecting } from "./SessionGate";
import { fetchBootstrap, recheckBootstrap } from "./sessionBootstrap";
import { gateKind, gateClosed, clearPrivateQueries, useResourceFailures } from "./sessionAccess";
export { PANEL_READ } from "./sessionAccess";
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

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}

function useDraftOwner(identity: string | undefined, gate: ReturnType<typeof gateKind>) {
  const clear = gate === "sign_in" || gate === "forbidden";
  const unconfirmed = gate === "unconfirmed";
  const [owner, setOwner] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (clear) {
      clearDrafts();
      setOwner(null);
    } else if (unconfirmed) setOwner(null);
    else if (identity) {
      activateDrafts(identity);
      setOwner(identity);
    }
  }, [identity, clear, unconfirmed]);
  return owner;
}

function useUpdateAvailable(digest: string | null | undefined, ready: boolean) {
  const initial = useRef<{ value: string | null | undefined } | null>(null);
  if (ready && initial.current === null) initial.current = { value: digest };
  return !!initial.current?.value && !!digest && initial.current.value !== digest;
}

function sessionGate(bootstrapError: Error | null, resourceFailure: Error | null) {
  const failure = isProtectedReadFailure(bootstrapError)
    ? bootstrapError
    : (resourceFailure ?? bootstrapError);
  return gateKind(failure, resourceFailure);
}

function useSessionState() {
  const client = useQueryClient();
  const failures = useResourceFailures(client);
  const query = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => fetchBootstrap(signal),
    refetchInterval: 30_000,
    retry: false,
  });
  const gate = sessionGate(query.error, failures.resourceFailure);
  const context = query.data?.queryContext;
  const identity = context && draftIdentity(context);
  const blocked = failures.blockedFor(identity);
  const owner = useDraftOwner(identity, gate);
  const updateAvailable = useUpdateAvailable(query.data?.bootstrap.dashboardDigest, !!query.data);
  useLayoutEffect(() => {
    clearPrivateQueries(client, context, blocked, gateClosed(gate));
  }, [client, context, blocked, gate]);

  function retry() {
    void recheckBootstrap(client).then((state) => {
      if (state?.status === "success") failures.clearFailure();
    });
  }
  function reportIncompatible(capability: string) {
    if (identity) failures.block(identity, [capability]);
  }
  const value = query.data && {
    ...query.data,
    bootstrap: blockIncompatibleFeatures(query.data.bootstrap, blocked),
    connection: query.isError ? ("unreachable" as const) : ("connected" as const),
    updateAvailable,
    reportIncompatible,
    reportAccessDenied: failures.reportAccessDenied,
  };
  return { value, gate, retry, ownerReady: owner === identity };
}

/** Blocks the app until AQ identifies the principal and its capabilities. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { value, gate, retry, ownerReady } = useSessionState();
  if (value && !gateClosed(gate)) {
    return <SessionContext.Provider value={value}>{ownerReady ? children : null}</SessionContext.Provider>;
  }
  if (gate) return <SessionGate kind={gate} retry={retry} />;
  return <Connecting />;
}
