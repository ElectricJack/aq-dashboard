import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { validateReadEnvelope } from "../../api/adapters/envelope";
import { adaptSessionDetail, type SessionDetailView } from "../../api/adapters/inspection";
import { adaptGraphEnvelope, adaptGraphParent, adaptStateCounts, graphCount, validGraphId, type GraphParent, type GraphStateCounts } from "../../api/adapters/humanGraph";
import { adaptResultsFeed, viewScoped, type ResultDetail } from "../../api/adapters/resultsFeedback";
import { graphPath } from "../../api/humanGraphReads";
import { queryKey } from "../../api/queryKeys";
import { readRetry } from "../../api/retry";
import type { Envelope, SessionDetail } from "../../api/wire/proposed";
import { PANEL_READ, useSession } from "../../app/session";

/**
 * The task view's reads (spec 0004 Phase 1). Each section reads only while it is shown, every read uses the
 * app's retry policy, and each is a panel read: a response this bundle can't adapt fails its section, never
 * the whole view (W69). The human Graph API runs four requests at a time per server and queues twelve
 * more; the inspector keeps to a handful at once (detail, work, neighborhood, history) and issues the rest
 * (summary, sessions, history pages) only on demand and one or two at a time.
 */

function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid task work read"); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }
const TASK_STATES = ["draft", "active", "completed", "canceled"];
const time = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));

/* ----- Work: readiness, blockers, parent, holding attempt (X8, X9, X12) ----- */

/** The attempt holding a task, from `GET …/tasks/{t}/work` (`execution`, null when none holds it). */
export type TaskExecution = { attempt_id: string; session_id: string; status: string };
/** The readiness states this bundle knows (human-graph-1 X8; `held` since aq-server #99, QA P1-01). */
export const READINESS_STATES = ["draft", "completed", "canceled", "running", "held", "waiting", "unknown", "ready"] as const;
/** A known readiness state, or `unrecognized` for a value a newer server sends that this bundle doesn't know (W77). */
export type WorkReadiness = (typeof READINESS_STATES)[number] | "unrecognized";
/** Codes AQ gives for a hold; a newer code is kept as reported and its message still shown. */
export const HOLD_REASON_CODES = ["cancelled_attempt_holds_task", "attempt_stopped_not_released", "attempt_finished_stop_unconfirmed"] as const;
/** Why a stopped or finished attempt still holds the task (`readiness.reasons`, at most 4). */
export type HoldReason = { code: string; attempt_id: string; status: string; message: string };
/** `satisfied` is true only for a completed blocker, null when the blocker isn't in the read Context. */
export type TaskBlocker = { edge_id: string; id: string; title: string | null; task_state: string | null; satisfied: boolean | null };
/** `reported` is the server's readiness value as sent: for `unrecognized`, the value to show. */
export type TaskWork = { state: WorkReadiness; reported: string; reasons: HoldReason[]; execution: TaskExecution | null; blockers: TaskBlocker[]; complete: boolean; parent: GraphParent | null };

/**
 * An open enum value (W77): a short identifier a newer server may add. Unknown values degrade to a neutral
 * "Unknown (value)" instead of failing the read; anything that isn't a bounded identifier still fails it.
 */
export const openEnumValue = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(v);

export function adaptTaskWork(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (value): TaskWork => {
    check(isRecord(value) && value.task_id === id && isRecord(value.readiness) && Array.isArray(value.readiness.blockers) && value.readiness.blockers.length <= 64 && typeof value.readiness.complete === "boolean");
    // An older server without `readiness.state` reads as unknown, never as ready.
    const reported = value.readiness.state === undefined ? "unknown" : value.readiness.state;
    check(openEnumValue(reported));
    const state: WorkReadiness = (READINESS_STATES as readonly string[]).includes(reported) ? reported as WorkReadiness : "unrecognized";
    // `reasons` is required from aq-server #99; an older server omits it.
    const rawReasons = value.readiness.reasons === undefined ? [] : value.readiness.reasons;
    check(Array.isArray(rawReasons) && rawReasons.length <= 4);
    const reasons = rawReasons.map((r): HoldReason => {
      check(isRecord(r) && openEnumValue(r.code) && validGraphId(r.attempt_id) && text(r.status, 64) && text(r.message, 512));
      return { code: r.code as string, attempt_id: r.attempt_id as string, status: r.status as string, message: r.message as string };
    });
    const e = value.execution;
    check(e === null || (isRecord(e) && validGraphId(e.attempt_id) && validGraphId(e.session_id) && text(e.status, 64)));
    const blockers = value.readiness.blockers.map((b): TaskBlocker => {
      check(isRecord(b) && validGraphId(b.edge_id) && validGraphId(b.id) && (b.satisfied === null || typeof b.satisfied === "boolean"));
      check(b.title === undefined || b.title === null || (typeof b.title === "string" && b.title.length <= 1024));
      check(b.task_state === undefined || b.task_state === null || TASK_STATES.includes(b.task_state as string));
      return { edge_id: b.edge_id, id: b.id, title: (b.title as string | null | undefined) ?? null, task_state: (b.task_state as string | null | undefined) ?? null, satisfied: b.satisfied as boolean | null };
    });
    return { state, reported, reasons, execution: e === null ? null : { attempt_id: e.attempt_id as string, session_id: e.session_id as string, status: e.status as string }, blockers, complete: value.readiness.complete, parent: adaptGraphParent(value.parent) };
  });
}

/** Readiness, blockers, parent and the holding attempt; `undefined` while unknown (pending, failed or not served). */
export function useTaskWork(project: string, id: string) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "human-graph-task-work", { project, id }), enabled: validGraphId(project) && validGraphId(id), refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }) => adaptTaskWork(await apiGet<unknown>(`${graphPath(project, "task", id)}/work`, signal), project, id),
  });
}

/* ----- History: change timeline and recorded attempts (X13) ----- */

/**
 * What one history entry changed (aq-server #99), or null when AQ can't describe it. `from`/`to` are given only
 * for task state, priority, content type, retired and deleted; `complete` is false when AQ couldn't compare a
 * revision with the previous one (then `fields` is empty).
 */
export type HistoryChange = { summary: string; fields: { field: string; from: string | null; to: string | null }[]; edge: { edge_type: string; direction: "incoming" | "outgoing"; node_id: string } | null; complete: boolean };
export type HistoryEntry = { sequence: string; entry_id: string; category: "revision" | "lifecycle" | "edge"; operation: string; actor_id: string; reason: string | null; created_at: string; change: HistoryChange | null };
export type TaskAttempt = { attempt_id: string; session_id: string; holds_task: boolean; status: string };
export type TaskHistoryPage = { items: HistoryEntry[]; next_cursor: string | null; attempts: TaskAttempt[]; attempts_truncated: boolean };

const changeValue = (v: unknown) => v === null || (typeof v === "string" && v.length <= 64);
/** A history entry's `change`; absent (an older server) reads as null. Field names are an open enum (W77). */
export function adaptHistoryChange(c: unknown): HistoryChange | null {
  if (c === undefined || c === null) return null;
  check(isRecord(c) && typeof c.summary === "string" && c.summary.length <= 512 && Array.isArray(c.fields) && c.fields.length <= 16 && typeof c.complete === "boolean");
  const fields = c.fields.map(f => {
    check(isRecord(f) && openEnumValue(f.field) && changeValue(f.from) && changeValue(f.to));
    return { field: f.field as string, from: f.from as string | null, to: f.to as string | null };
  });
  const e = c.edge;
  check(e === null || (isRecord(e) && text(e.edge_type, 64) && (e.direction === "incoming" || e.direction === "outgoing") && validGraphId(e.node_id)));
  return { summary: c.summary, fields, edge: e === null ? null : { edge_type: e.edge_type as string, direction: e.direction as "incoming" | "outgoing", node_id: e.node_id as string }, complete: c.complete };
}

export function adaptTaskHistory(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (value): TaskHistoryPage => {
    check(isRecord(value) && value.task_id === id && Array.isArray(value.items) && value.items.length <= 25 && Array.isArray(value.attempts) && value.attempts.length <= 16 && typeof value.attempts_truncated === "boolean");
    check(value.next_cursor === null || text(value.next_cursor, 4096));
    const items = value.items.map((h): HistoryEntry => {
      check(isRecord(h) && typeof h.sequence === "string" && /^[1-9][0-9]{0,18}$/.test(h.sequence) && validGraphId(h.entry_id));
      check(["revision", "lifecycle", "edge"].includes(h.category as string) && text(h.operation, 128) && text(h.actor_id, 512) && (h.reason === null || (typeof h.reason === "string" && h.reason.length <= 4096)) && time(h.created_at));
      return { sequence: h.sequence, entry_id: h.entry_id, category: h.category as HistoryEntry["category"], operation: h.operation, actor_id: h.actor_id, reason: h.reason as string | null, created_at: h.created_at, change: adaptHistoryChange(h.change) };
    });
    const attempts = value.attempts.map((a): TaskAttempt => {
      check(isRecord(a) && validGraphId(a.attempt_id) && validGraphId(a.session_id) && typeof a.holds_task === "boolean" && text(a.status, 64));
      return { attempt_id: a.attempt_id, session_id: a.session_id, holds_task: a.holds_task, status: a.status };
    });
    check(new Set(attempts.map(a => a.attempt_id)).size === attempts.length);
    return { items, next_cursor: value.next_cursor as string | null, attempts, attempts_truncated: value.attempts_truncated };
  });
}

/** Graph history is oldest first, 25 per page; reading to the newest entry is bounded to this many pages. */
export const HISTORY_MAX_PAGES = 12;

/**
 * `GET …/tasks/{t}/history`, one page at a time. The first page also carries the task's attempts (up to 16,
 * the holding attempt first), so the Attempts section, the History section and Retry attempt's precondition
 * share one read. Further pages are read only when History is open.
 */
export function useTaskHistory(project: string, id: string, enabled = true) {
  const { queryContext } = useSession();
  return useInfiniteQuery({
    queryKey: queryKey(queryContext, "human-graph-task-history", { project, id }), enabled: enabled && validGraphId(project) && validGraphId(id),
    initialPageParam: null as string | null, refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ pageParam, signal }) => {
      const params = pageParam ? `?${new URLSearchParams({ cursor: pageParam })}` : "";
      return adaptTaskHistory(await apiGet<unknown>(`${graphPath(project, "task", id)}/history${params}`, signal), project, id);
    },
    getNextPageParam: (last, all) => all.length < HISTORY_MAX_PAGES ? last.data.next_cursor ?? undefined : undefined,
  });
}

/* ----- Summary: descendant counts for an epic (X11) ----- */

export type TaskSummary = { total: string; by_state: GraphStateCounts; complete: boolean };
export function adaptTaskSummary(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (value): TaskSummary => {
    check(isRecord(value) && value.task_id === id && value.scope === "descendants" && isRecord(value.implementation));
    const i = value.implementation;
    check(graphCount(i.total) && typeof i.complete === "boolean");
    return { total: i.total, by_state: adaptStateCounts(i.by_state), complete: i.complete };
  });
}
/** Read only for a task the neighborhood shows to have children. */
export function useTaskSummary(project: string, id: string, enabled: boolean) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "human-graph-task-summary", { project, id }), enabled: enabled && validGraphId(project) && validGraphId(id), refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }) => adaptTaskSummary(await apiGet<unknown>(`${graphPath(project, "task", id)}/summary`, signal), project, id),
  });
}

/* ----- Sessions: provider, model, harness and times per attempt ----- */

/** At most two session reads at a time, so a long attempt list never bursts the read API. */
const SESSION_READS = 2;
let running = 0;
const waiting: (() => void)[] = [];
export async function limited<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (running >= SESSION_READS) {
    await new Promise<void>((resolve, reject) => {
      const go = () => { signal?.removeEventListener("abort", stop); resolve(); };
      const stop = () => { const at = waiting.indexOf(go); if (at >= 0) waiting.splice(at, 1); reject(signal!.reason); };
      waiting.push(go); signal?.addEventListener("abort", stop, { once: true });
    });
  }
  running++;
  try { return await work(); } finally { running--; waiting.shift()?.(); }
}

/** `GET /api/v1/sessions/{id}` for one attempt's session; the server rechecks access per session. */
export function useAttemptSession(sessionId: string, enabled: boolean) {
  const { queryContext, bootstrap } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-attempt-session", { id: sessionId }), enabled: enabled && validGraphId(sessionId) && bootstrap.capability("sessions.read").enabled,
    refetchOnWindowFocus: false, staleTime: 30_000, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }): Promise<SessionDetailView> => limited(async () => {
      const env = await apiGet<Envelope<SessionDetail>>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, signal);
      validateReadEnvelope(env, queryContext.contractVersion);
      if (!isRecord(env.data) || env.data.id !== sessionId) throw new ContractError("Session detail identity changed");
      return adaptSessionDetail(env.data, env.server_time);
    }, signal),
  });
}

/* ----- Results for the task (G6 feed) ----- */

export const TASK_RESULTS_LIMIT = 5;
/** `GET /api/v1/results?task_id=`: the task's latest results, newest first. */
export function useTaskResults(project: string, task: string, enabled: boolean) {
  const { queryContext, bootstrap } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-results", { project, task }), enabled: enabled && validGraphId(project) && validGraphId(task) && bootstrap.capability("results.read").enabled,
    refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }): Promise<{ items: ResultDetail[]; more: boolean; serverTime: string | null }> => {
      const params = new URLSearchParams({ mode: "latest", scope: "project", project_id: project, task_id: task, media: "any", limit: String(TASK_RESULTS_LIMIT) });
      const raw = await apiGet<unknown>(`/api/v1/results?${params}`, signal);
      return viewScoped(() => {
        const page = adaptResultsFeed(raw, { kind: "project", project_id: project });
        if (page.items.some(i => i.result.task_id !== task)) throw new ContractError("Results for another task");
        return { items: page.items, more: !!page.next_cursor, serverTime: isRecord(raw) && typeof raw.server_time === "string" ? raw.server_time : null };
      });
    },
  });
}

/* ----- Comments (spec 0004 item 13, §4.1; human-graph-1 `HumanComments`) ----- */

export type CommentAuthor = { kind: "owner" | "agent" | "supervisor" | "system"; user_id: string | null; display_name: string | null; session_id: string | null; attempt_id: string | null };
export type TaskComment = { comment_id: string; task_id: string; author: CommentAuthor; body: string | null; created_at: string; edited_at: string | null; deleted_at: string | null; revision: string; can_edit: boolean };
export type TaskComments = { task_id: string; items: TaskComment[]; next_cursor: string | null };
export const COMMENTS_PAGE = 50;
/** Markdown body bound (§4.1): nonblank, 16 KiB of UTF-8, no control characters but tab, LF and CR. */
export const COMMENT_MAX_BYTES = 16384;
const nullableId = (v: unknown) => v === null || validGraphId(v);
const nullableTime = (v: unknown) => v === null || time(v);

export function adaptTaskComments(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (value): TaskComments => {
    check(isRecord(value) && value.task_id === id && Array.isArray(value.items) && value.items.length <= 100 && (value.next_cursor === null || text(value.next_cursor, 4096)));
    const items = value.items.map((c): TaskComment => {
      check(isRecord(c) && validGraphId(c.comment_id) && c.task_id === id && isRecord(c.author));
      const a = c.author;
      check(["owner", "agent", "supervisor", "system"].includes(a.kind as string) && nullableId(a.user_id) && nullableId(a.session_id) && nullableId(a.attempt_id) && (a.display_name === null || (typeof a.display_name === "string" && a.display_name.length <= 320)));
      check(time(c.created_at) && nullableTime(c.edited_at) && nullableTime(c.deleted_at) && typeof c.revision === "string" && /^[1-9][0-9]{0,18}$/.test(c.revision) && typeof c.can_edit === "boolean");
      // A tombstone has no body; a live comment has a nonblank one.
      check(c.deleted_at === null ? text(c.body, COMMENT_MAX_BYTES) : c.body === null);
      return { comment_id: c.comment_id, task_id: id, author: { kind: a.kind as CommentAuthor["kind"], user_id: a.user_id as string | null, display_name: a.display_name as string | null, session_id: a.session_id as string | null, attempt_id: a.attempt_id as string | null },
        body: c.body as string | null, created_at: c.created_at, edited_at: c.edited_at as string | null, deleted_at: c.deleted_at as string | null, revision: c.revision, can_edit: c.can_edit && c.deleted_at === null };
    });
    check(new Set(items.map(c => c.comment_id)).size === items.length);
    return { task_id: id, items, next_cursor: value.next_cursor as string | null };
  });
}

/** `GET …/tasks/{t}/comments`: newest first, 50 per page; older pages on request (cursors last 10 minutes). */
export function useTaskComments(project: string, id: string, enabled: boolean) {
  const { queryContext } = useSession();
  return useInfiniteQuery({
    queryKey: queryKey(queryContext, "task-comments", { project, id }), enabled: enabled && validGraphId(project) && validGraphId(id),
    initialPageParam: null as string | null, refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(COMMENTS_PAGE) });
      if (pageParam) params.set("cursor", pageParam);
      return adaptTaskComments(await apiGet<unknown>(`${graphPath(project, "task", id)}/comments?${params}`, signal), project, id);
    },
    getNextPageParam: last => last.data.next_cursor ?? undefined,
  });
}

/** Why a comment body can't be sent, or null. */
export function commentProblem(body: string): string | null {
  if (!body.trim()) return "Write a comment first.";
  if (new TextEncoder().encode(body).length > COMMENT_MAX_BYTES) return "Comments can be at most 16 KB. Shorten this one.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(body)) return "Remove the control characters from this comment.";
  return null;
}
