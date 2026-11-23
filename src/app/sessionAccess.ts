import type { QueryClient, QueryCacheNotifyEvent, Query } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { ContractError } from "../api/adapters/contract";
import { ApiError, isAccessRefusal, isAuthenticationFailure, isProtectedReadFailure } from "../api/client";
import type { QueryContext } from "../api/queryKeys";
import { capabilitiesForResource } from "./compatibility";
import { clearDrafts } from "./drafts";
import { recheckBootstrap } from "./sessionBootstrap";

/** Panel read failures stay in the view, except sign-in, refusal, and unsupported API responses. */
export const PANEL_READ = { failure: "panel" } as const;
export type GateKind = "sign_in" | "forbidden" | "unconfirmed" | "incompatible" | "unavailable";
export function gateKind(failure: Error | null, resourceFailure: Error | null): GateKind | null {
  if (!failure) return null;
  if (failure instanceof ContractError) return "incompatible";
  if (!(failure instanceof ApiError)) return "unavailable";
  if (failure.status === 401) return "sign_in";
  if (failure.status === 403) return failure === resourceFailure ? "unconfirmed" : "forbidden";
  if (unsupportedResponse(failure)) return "incompatible";
  return "unavailable";
}

function unsupportedResponse(error: ApiError) {
  return error.kind === "contract" || [404, 426].includes(error.status ?? 0);
}
export function gateClosed(gate: GateKind | null) {
  return gate !== null && gate !== "unavailable";
}

const noBlockedFeatures = new Set<string>();
type Failures = { identity: string; capabilities: Set<string> };
type FailureActions = {
  block(identity: string, capabilities: string[]): void;
  verify(error: Error): void;
  close(error: Error): void;
};
function onQueryFailure(event: QueryCacheNotifyEvent, actions: FailureActions) {
  if (event.type !== "updated" || event.action.type !== "error") return;
  const query = event.query,
    key = query.queryKey;
  if (key[0] !== "aq") return;
  handleResourceError(query, actions);
}

function handleResourceError(query: Query, actions: FailureActions) {
  const key = query.queryKey;
  const error = query.state.error;
  const clear = () => query.setState({ data: undefined, dataUpdatedAt: 0 });
  if (error instanceof ApiError && error.status === 426) {
    actions.block(JSON.stringify([key[1], key[2]]), capabilitiesForResource(String(key[4])));
    clear();
    return;
  }
  if (isAccessRefusal(error)) {
    removeRefusedData(query);
    actions.verify(error);
    return;
  }
  if (panelFailure(query)) {
    if (isProtectedReadFailure(error)) clear();
    return;
  }
  if (isProtectedReadFailure(error)) actions.close(error);
}

function panelFailure(query: Query) {
  return query.meta?.failure === PANEL_READ.failure && !isAuthenticationFailure(query.state.error);
}
function removeRefusedData(query: Query) {
  // Seeded queries keep their initial data and show the refusal in the affected view.
  if (query.options.initialData === undefined) query.setState({ data: undefined, dataUpdatedAt: 0 });
}

/** A single bootstrap recheck serves concurrent refusals. The first failure owns its outcome. */
export function useResourceFailures(client: QueryClient) {
  const [resourceFailure, setResourceFailure] = useState<Error | null>(null);
  const [features, setFeatures] = useState<Failures>({ identity: "", capabilities: noBlockedFeatures });
  const checking = useRef<Promise<unknown> | null>(null);
  function verify(error: Error) {
    if (checking.current) return;
    checking.current = recheckBootstrap(client)
      .then((state) => {
        if (state?.status === "error" && !isProtectedReadFailure(state.error)) setResourceFailure(error);
      })
      .finally(() => {
        checking.current = null;
      });
  }
  function block(identity: string, capabilities: readonly string[]) {
    setFeatures((previous) => ({
      identity,
      capabilities: new Set([
        ...(previous.identity === identity ? previous.capabilities : []),
        ...capabilities,
      ]),
    }));
  }
  useLayoutEffect(
    () =>
      client
        .getQueryCache()
        .subscribe((event) => onQueryFailure(event, { block, verify, close: setResourceFailure })),
    [client],
  );
  function reportAccessDenied(error: ApiError) {
    if (isAuthenticationFailure(error)) {
      clearDrafts();
      setResourceFailure(error);
    } else verify(error);
  }
  function blockedFor(identity: string | undefined) {
    return features.identity === identity ? features.capabilities : noBlockedFeatures;
  }
  return {
    resourceFailure,
    clearFailure: () => setResourceFailure(null),
    block,
    blockedFor,
    reportAccessDenied,
  };
}

/** Cancels and removes reads whose capability or authorizing identity is no longer current. */
export function clearPrivateQueries(
  client: QueryClient,
  context: QueryContext | undefined,
  blocked: Set<string>,
  closed: boolean,
) {
  function obsolete(key: readonly unknown[]) {
    if (key[0] !== "aq") return false;
    if (closed || !context) return true;
    if (capabilitiesForResource(String(key[4])).some((capability) => blocked.has(capability))) return true;
    return (
      key[1] !== context.principalId ||
      key[2] !== context.authorizationRevision ||
      key[3] !== context.contractVersion
    );
  }
  void client.cancelQueries({ predicate: (query) => obsolete(query.queryKey) });
  client.removeQueries({ predicate: (query) => obsolete(query.queryKey) });
}
