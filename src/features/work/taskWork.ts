import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { validateReadEnvelope } from "../../api/adapters/envelope";
import { adaptSessionDetail, type SessionDetailView } from "../../api/adapters/inspection";
import { adaptGraphEnvelope, adaptStateCounts, graphCount, validGraphId, type GraphStateCounts } from "../../api/adapters/humanGraph";
import { adaptResultsFeed, viewScoped, type ResultDetail } from "../../api/adapters/resultsFeedback";
import { useTaskPanel, validTaskRef, type TaskRef } from "./taskGraphPanels";
import { queryKey, type QueryContext } from "../../api/queryKeys";
import { readRetry } from "../../api/retry";
import type { Envelope, SessionDetail } from "../../api/wire/proposed";
import { adaptTaskWork } from "./taskReadiness";
import { adaptTaskRoutes } from "./taskRouting";
import { adaptTaskHistory } from "./taskHistory";
import { adaptTaskComments, COMMENTS_PAGE, COMMENT_MAX_BYTES } from "./taskCommentRecords";
import { check, taskRecord } from "./taskWorkFields";
import { PANEL_READ, useSession } from "../../app/session";

/**
 * The task view's reads (spec 0004 Phase 1). Each section reads only while it is shown, every read uses the
 * app's retry policy, and each is a panel read: a response this bundle can't adapt fails its section, never
 * the whole view (W69). The human Graph API runs four requests at a time per server and queues twelve
 * more; the inspector keeps to a handful at once (detail, work, neighborhood, history) and issues the rest
 * (summary, sessions, history pages) only on demand and one or two at a time.
 */

export { adaptRanWith, type RanWith, type TaskExecution } from "./taskExecution";
export { useTaskWork, adaptTaskRole, type TaskRole, READINESS_STATES, HOLD_REASON_CODES, type StartupOverLimit, type HoldReason, type TaskBlocker, type TaskWork, type WorkReadiness } from "./taskReadiness";
export { adaptTaskWork, adaptTaskRoutes, adaptTaskHistory, adaptTaskComments, COMMENTS_PAGE, COMMENT_MAX_BYTES };
export { adaptTaskRouting, type TaskRouteView, type TaskRouting, type TaskRouteEntry } from "./taskRouting";
export { useTaskHistory, HISTORY_MAX_PAGES, adaptHistoryChange, type HistoryChange, type HistoryEntry, type TaskHistoryPage, type TaskAttempt } from "./taskHistory";
export { useTaskComments, commentProblem, type TaskComment, type CommentAuthor, type TaskComments } from "./taskCommentRecords";
export { openEnumValue } from "./taskWorkFields";

export { useTaskRoutes } from "./taskRouting";

/* ----- Summary: descendant counts for an epic (X11) ----- */

export type TaskSummary = { total: string; by_state: GraphStateCounts; complete: boolean };
function descendantSummary(value: Record<string, unknown>): TaskSummary {
  check(value.scope === "descendants");
  const counts = value.implementation;
  check(isRecord(counts));
  check(graphCount(counts.total));
  check(typeof counts.complete === "boolean");
  return { total: counts.total, by_state: adaptStateCounts(counts.by_state), complete: counts.complete };
}

export function adaptTaskSummary(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, data => descendantSummary(taskRecord(data, id)));
}

/** Read when an inspector action or the hierarchy section needs descendant counts. */
export function useTaskSummary(project: string, id: string, enabled: boolean) {
  return useTaskPanel({ project, id }, { key: "human-graph-task-summary", section: "summary", adapt: adaptTaskSummary, enabled });
}

/* ----- Sessions: provider, model, harness and times per attempt ----- */

/** At most two session reads at a time, so a long attempt list never bursts the read API. */
const SESSION_READS = 2;
let running = 0;
const waiting: (() => void)[] = [];
function waitForSessionRead(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    function resume() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      const index = waiting.indexOf(resume);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal?.reason);
    }
    waiting.push(resume);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

export async function limited<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (running >= SESSION_READS) await waitForSessionRead(signal);
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function readAttemptSession(request: { id: string; signal: AbortSignal; context: QueryContext }): Promise<SessionDetailView> {
  const { id, signal, context } = request;
  const env = await apiGet<Envelope<SessionDetail>>(`/api/v1/sessions/${encodeURIComponent(id)}`, signal);
  validateReadEnvelope(env, context.contractVersion);
  if (!isRecord(env.data) || env.data.id !== id) throw new ContractError("Session detail identity changed");
  return adaptSessionDetail(env.data, env.server_time);
}

/** `GET /api/v1/sessions/{id}` for one attempt's session; the server rechecks access per session. */
export function useAttemptSession(sessionId: string, enabled: boolean) {
  const { queryContext, bootstrap } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-attempt-session", { id: sessionId }), enabled: enabled && validGraphId(sessionId) && bootstrap.capability("sessions.read").enabled,
    refetchOnWindowFocus: false, staleTime: 30_000, meta: PANEL_READ, ...readRetry,
    queryFn: ({ signal }) => limited(() => readAttemptSession({ id: sessionId, signal, context: queryContext }), signal),
  });
}

/* ----- Results for the task (G6 feed) ----- */

export const TASK_RESULTS_LIMIT = 5;
type TaskResults = { items: ResultDetail[]; more: boolean; serverTime: string | null };

function resultServerTime(raw: unknown) {
  return isRecord(raw) && typeof raw.server_time === "string" ? raw.server_time : null;
}

function taskResultPage(raw: unknown, task: TaskRef): TaskResults {
  const page = adaptResultsFeed(raw, { kind: "project", project_id: task.project });
  if (page.items.some(item => item.result.task_id !== task.id)) throw new ContractError("Results for another task");
  return { items: page.items, more: !!page.next_cursor, serverTime: resultServerTime(raw) };
}

async function readTaskResults(task: TaskRef, signal: AbortSignal) {
  const params = new URLSearchParams({
    mode: "latest", scope: "project", project_id: task.project, task_id: task.id, media: "any", limit: String(TASK_RESULTS_LIMIT),
  });
  const raw = await apiGet<unknown>(`/api/v1/results?${params}`, signal);
  return viewScoped(() => taskResultPage(raw, task));
}

/** `GET /api/v1/results?task_id=`: the task's latest results, newest first. */
export function useTaskResults(project: string, task: string, enabled: boolean) {
  const { queryContext, bootstrap } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-results", { project, task }), enabled: enabled && validTaskRef({ project, id: task }) && bootstrap.capability("results.read").enabled,
    refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: ({ signal }) => readTaskResults({ project, id: task }, signal),
  });
}
