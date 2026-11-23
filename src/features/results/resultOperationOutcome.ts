import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { ResultsPage } from "../../api/wire/resultsFeedback";
import { apiGet, apiSend, ApiError } from "../../api/client";
import type { ResultOperation } from "../../api/adapters/resultsFeedback";
import type { useSession } from "../../app/session";

export type Intent = { id: string; method: "POST" | "PUT"; path: string; body: unknown; recoveryPath?: string };
export type Attempt = "submit" | "lookup" | "recover";
type Session = ReturnType<typeof useSession>;
type Entity = ResultOperation["affected_entities"][number];
type Revision = Entity & { revision: string };

export function readOperation(kind: Attempt, intent: Intent, signal: AbortSignal) {
  if (kind === "lookup") return apiGet<unknown>(`/api/v1/operations/${intent.id}`, signal);
  if (kind === "recover") return apiSend<unknown>("POST", intent.recoveryPath!, {}, signal);
  return apiSend<unknown>(intent.method, intent.path, intent.body, signal);
}

function resultRevision(entity: Entity): entity is Revision {
  return entity.type === "result" && /^[1-9][0-9]*$/.test(entity.revision ?? "");
}

function updatePage(page: ResultsPage, entity: Revision) {
  const items = page.items.map(item => {
    if (item.result.id !== entity.id) return item;
    if (BigInt(item.result.version) >= BigInt(entity.revision)) return item;
    return { ...item, result: { ...item.result, version: entity.revision } };
  });
  return { ...page, items };
}

export function updateResultFeed(client: QueryClient, context: Session["queryContext"], operation: ResultOperation) {
  if (operation.disposition !== "confirmed") return;
  for (const entity of operation.affected_entities.filter(resultRevision)) {
    client.setQueriesData<InfiniteData<ResultsPage>>({
      predicate: ({ queryKey }) => queryKey[0] === "aq" && queryKey[1] === context.principalId
        && queryKey[2] === context.authorizationRevision && queryKey[4] === "result-feed",
    }, old => old && { ...old, pages: old.pages.map(page => updatePage(page, entity)) });
  }
}

export function checkIdentity(previous: ResultOperation | null, current: ResultOperation) {
  if (previous?.operation_id !== current.operation_id) return;
  if (previous.request_digest !== current.request_digest) throw new Error("Operation identity changed");
}

export function outcomeError(error: unknown, session: Session, capability: string) {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 401 || error.status === 403) session.reportAccessDenied(error);
  if (error.status === 426) session.reportIncompatible(capability);
  return error.status === 403 ? error.serverMessage ?? "" : null;
}

export function permitsRecovery(status: ResultOperation | null) {
  return !status || status.recovery === "lookup_original";
}

export function completed(status: ResultOperation | null) {
  return status !== null && ["confirmed", "conflict", "rejected"].includes(status.disposition);
}
