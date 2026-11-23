import { useQuery } from "@tanstack/react-query";
import { observedEnded, observedRunning } from "../labels";
import { manualSession, type HistorySession } from "../../../api/sessionHistory";
import { adaptSessionDetail, type SessionDetailView } from "../../../api/adapters/inspection";
import type { SessionDetail } from "../../../api/wire/proposed";
import { ContractError } from "../../../api/adapters/contract";
import { ApiError, isProtectedReadFailure } from "../../../api/client";
import { PANEL_READ, useSession } from "../../../app/session";
import { useRead } from "../../../app/useRead";
import type { Row } from "./terminalRows";

function refusal(error: unknown) {
  return isProtectedReadFailure(error) || (error instanceof ApiError && [404, 410].includes(error.status ?? 0));
}
function missingNativeStatus(row: Row, error: boolean) {
  if (row.status !== "Loading") return "State unknown";
  return error ? "Unavailable" : "Loading";
}
function nativeStatus(row: Row, session: SessionDetailView | undefined, error: boolean) {
  if (!session) return missingNativeStatus(row, error);
  if (session.lifecycle?.stoppedAt || observedEnded(session.observation.state)) return "stopped";
  if (!observedRunning(session.observation.state)) return "State unknown";
  return session.observation.freshness === "stale" ? "Running (stale)" : "Running";
}
function manualStatus(row: Row, session: HistorySession | undefined, present: boolean, error: boolean) {
  if (present && row.status !== "Loading") return row.status;
  if (session) return session.status;
  return row.status === "Loading" && error ? "Unavailable" : row.status;
}

function useNativeSession(row: Row, project: string | null) {
  return useRead<SessionDetail, SessionDetailView>({
    resource: "session", path: `/api/v1/sessions/${encodeURIComponent(row.id)}`,
    scope: project ? { kind: "project", project_id: project } : { kind: "all_authorized" },
    enabled: !row.manual, pollMs: 5000, meta: PANEL_READ,
    adapt: (wire, time) => {
      if (wire.id !== row.id) throw new ContractError("Session identity changed");
      return adaptSessionDetail(wire, time);
    },
  });
}
function useManualSession(row: Row, project: string | null, present: boolean) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: ["manual-session", queryContext.principalId, queryContext.authorizationRevision, project, row.id],
    queryFn: ({ signal }) => manualSession(row.id, signal),
    enabled: row.manual && (row.status === "Loading" || !present), retry: false, meta: PANEL_READ,
  });
}

function nativeTitle(row: Row, session: SessionDetailView) {
  return session.task?.title ?? session.label ?? row.project;
}
function nativeIdentity(row: Row, session: SessionDetailView | undefined) {
  if (!session) return { project: row.projectId, terminalId: row.terminal, title: row.project };
  return { project: session.project.id ?? row.projectId, terminalId: session.terminal?.id ?? row.terminal, title: nativeTitle(row, session) };
}
function nativePane(row: Row, detail: ReturnType<typeof useNativeSession>) {
  const session = detail.data?.view;
  return {
    ...nativeIdentity(row, session), rejected: refusal(detail.error),
    status: nativeStatus(row, session, detail.isError),
    unavailable: detail.isError && !session,
  };
}
function manualIdentity(row: Row, session: HistorySession | undefined) {
  if (!session) return { project: row.projectId, terminalId: row.terminal, title: row.project };
  return { project: session.project_id, terminalId: session.id, title: session.spec.project_name ?? row.project };
}
function manualPane(row: Row, detail: ReturnType<typeof useManualSession>, present: boolean, fleetError: unknown) {
  const session = detail.data;
  return {
    ...manualIdentity(row, session), rejected: refusal(detail.error) || isProtectedReadFailure(fleetError),
    status: manualStatus(row, session, present, detail.isError), unavailable: detail.isError && row.status === "Loading",
  };
}

export function useTerminalSession(row: Row, project: string | null, present: boolean, fleetError: unknown) {
  const native = useNativeSession(row, project);
  const manual = useManualSession(row, project, present);
  const state = row.manual ? manualPane(row, manual, present, fleetError) : nativePane(row, native);
  const outsideScope = !!project && !!state.project && project !== state.project;
  const permitted = !state.rejected && !outsideScope;
  const ended = ["stopped", "failed"].includes(state.status);
  return { ...state, permitted, ended, title: permitted ? state.title : "Unavailable agent" };
}
