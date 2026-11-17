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
export type TaskExecution = { attempt_id: string; session_id: string; status: string; ran_with?: RanWith };
/**
 * What an attempt ran with (aq-server spec 0014 §7.1): its role, the level (intelligence profile) it was given, and the
 * candidate AQ selected. Absent for an attempt from before roles.
 */
export type RanWith = { role: string; level: string; provider: string; model: string; reasoning: string; harness: string; execution_profile: string; /** Null for an attempt recorded before roles: its summary was filled from its launch record. */ snapshot_digest: string | null };
const RAN_WITH_KEYS = ["role", "level", "provider", "model", "reasoning", "harness", "execution_profile", "snapshot_digest"] as const;
export function adaptRanWith(v: unknown): RanWith | undefined {
  if (v === undefined || v === null) return undefined;
  // The server bounds none of these strings and fills an old attempt's from its launch record, so an empty one is kept
  // as reported (shown as "unknown") instead of failing the whole Status or Attempts read.
  check(isRecord(v) && RAN_WITH_KEYS.every(key => (typeof v[key] === "string" && (v[key] as string).length <= 256) || (key === "snapshot_digest" && v[key] === null)));
  return Object.fromEntries(RAN_WITH_KEYS.map(key => [key, v[key] === "" && key === "snapshot_digest" ? null : v[key]])) as RanWith;
}
/** The role a task runs as (spec 0014 §5.5): the one the task names, or the project's default when it names none. */
export type TaskRole = { id: string; source: "task" | "project_default" };
/** Absent from a server that predates roles. */
export function adaptTaskRole(v: unknown): TaskRole | undefined {
  if (v === undefined) return undefined;
  check(isRecord(v) && text(v.id, 128) && (v.source === "task" || v.source === "project_default"));
  return { id: v.id, source: v.source };
}
/** The readiness states this bundle knows (human-graph-1 X8; `held` since aq-server #99, QA P1-01). */
export const READINESS_STATES = ["draft", "completed", "canceled", "running", "held", "waiting", "unknown", "ready"] as const;
/** A known readiness state, or `unrecognized` for a value a newer server sends that this bundle doesn't know (W77). */
export type WorkReadiness = (typeof READINESS_STATES)[number] | "unrecognized";
/** Codes AQ gives for a hold; a newer code is kept as reported and its message still shown. */
export const HOLD_REASON_CODES = ["cancelled_attempt_holds_task", "attempt_stopped_not_released", "attempt_finished_stop_unconfirmed", "task_held", "role_disabled", "role_missing", "level_missing", "startup_over_limit", "platform_text_missing"] as const;
/**
 * The startup text of a refused offer (`startup_over_limit`, aq-server spec 0014 §6.1): it is `bytes` long, over `limit`,
 * the smaller of the execution profile's `startup_context_bytes` and the project's `context_bytes` ceiling; `limiting`
 * says which of the two.
 */
export type StartupOverLimit = { bytes: number; limit: number; execution_profile: string; limiting: "startup_context_bytes" | "project_context_bytes" };
/**
 * Why AQ is not running the task (`readiness.reasons`, at most 4). A stopped or finished attempt that still holds it
 * names that attempt (`attempt_id`, `status`). A role hold (`role_disabled`, `role_missing`) names the `role` and a
 * level hold (`level_missing`) the `level`; those have no attempt. Nor has a refused offer: `startup_over_limit` carries
 * its two numbers (`startup`), `platform_text_missing` the `environment`.
 */
export type HoldReason = { code: string; message: string; attempt_id?: string; status?: string; hold_reason?: string; role?: string; level?: string; startup?: StartupOverLimit; environment?: string };
const bytes = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** The numbers of a `startup_over_limit` reason; a reason without them all still shows its message. */
function startupOverLimit(r: Record<string, unknown>): StartupOverLimit | undefined {
  if (r.code !== "startup_over_limit" || !bytes(r.bytes) || !bytes(r.limit) || !text(r.execution_profile, 128)) return undefined;
  return { bytes: r.bytes, limit: r.limit, execution_profile: r.execution_profile, limiting: r.limiting === "project_context_bytes" ? "project_context_bytes" : "startup_context_bytes" };
}
/** `satisfied` is true only for a completed blocker, null when the blocker isn't in the read Context. */
export type TaskBlocker = { edge_id: string; id: string; title: string | null; task_state: string | null; satisfied: boolean | null };
/** The route on a task (`routing.route` of the work read; spec 0011 §3): its class, e.g. `standard-high`, and who may take the task. */
export type TaskRouteView = { class: string; harnesses: string[]; providers: string[]; prefer: string[]; lane: string | null; provider_intent: string; source: string; policy_digest: string | null };
/**
 * Where a task stands in routing (aq-server, human-graph-1 `routing`, optional): `routed` with its route, or `waiting`
 * (routing is on and the task is ready with no route, so AQ does not offer it yet), or `unrouted` (no route, nothing held
 * back: routing is off or the task is not ready; no `since_ms`). `since_ms` is epoch milliseconds: when the route was
 * written, or, waiting, when the task was last updated. Absent when the task's project is not on an automatic router.
 */
export type TaskRouting = { state: "routed" | "waiting" | "unrouted"; route?: TaskRouteView; since_ms?: number };
/** `reported` is the server's readiness value as sent: for `unrecognized`, the value to show. */
export type TaskWork = { state: WorkReadiness; reported: string; role?: TaskRole; reasons: HoldReason[]; execution: TaskExecution | null; blockers: TaskBlocker[]; complete: boolean; parent: GraphParent | null; routing?: TaskRouting;
  /** AQ's default policy completed the task and found no file change (`completed_without_changes`, owner ruling 4b). */
  noChanges?: true };

/** A route's class is the id of an intelligence profile (a level); the server decides which ids exist. */
const levelId = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(v);
const names = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 32 && v.every(x => text(x, 128));
function adaptRoute(r: unknown): TaskRouteView {
  check(isRecord(r) && levelId(r.class) && names(r.harnesses) && names(r.providers) && names(r.prefer));
  check(r.lane === null || text(r.lane, 128));
  check(openEnumValue(r.provider_intent) && openEnumValue(r.source) && (r.policy_digest === null || text(r.policy_digest, 128)));
  return { class: r.class, harnesses: r.harnesses, providers: r.providers, prefer: r.prefer, lane: r.lane as string | null, provider_intent: r.provider_intent, source: r.source, policy_digest: r.policy_digest as string | null };
}
/** `routing` is optional: an older server, or a project not on an automatic router, omits it. */
export function adaptTaskRouting(r: unknown): TaskRouting | undefined {
  if (r === undefined) return undefined;
  check(isRecord(r));
  if (r.state === "unrouted") { check(r.route === undefined && r.since_ms === undefined); return { state: "unrouted" }; }
  check(typeof r.since_ms === "number" && Number.isSafeInteger(r.since_ms) && r.since_ms >= 0);
  if (r.state === "waiting") { check(r.route === undefined); return { state: "waiting", since_ms: r.since_ms }; }
  check(r.state === "routed");
  return { state: "routed", route: adaptRoute(r.route), since_ms: r.since_ms };
}

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
      check(isRecord(r) && openEnumValue(r.code) && text(r.message, 512));
      // A reason either names the attempt that holds the task, or (role and level holds) has no attempt at all.
      check(r.attempt_id === undefined ? r.status === undefined : validGraphId(r.attempt_id) && text(r.status, 64));
      check(r.hold_reason === undefined || (typeof r.hold_reason === "string" && r.hold_reason.length >= 1 && r.hold_reason.length <= 96));
      check((r.role === undefined || text(r.role, 128)) && (r.level === undefined || text(r.level, 128)));
      const startup = startupOverLimit(r);
      return { code: r.code as string, message: r.message as string, ...(r.attempt_id === undefined ? {} : { attempt_id: r.attempt_id as string, status: r.status as string }),
        ...(r.hold_reason === undefined ? {} : { hold_reason: r.hold_reason as string }), ...(r.role === undefined ? {} : { role: r.role as string }), ...(r.level === undefined ? {} : { level: r.level as string }),
        ...(startup ? { startup } : {}), ...(r.code === "platform_text_missing" && text(r.environment, 512) ? { environment: r.environment } : {}) };
    });
    const routing = adaptTaskRouting(value.routing), role = adaptTaskRole(value.role);
    check(value.completed_without_changes === undefined || value.completed_without_changes === true);
    const e = value.execution;
    check(e === null || (isRecord(e) && validGraphId(e.attempt_id) && validGraphId(e.session_id) && text(e.status, 64)));
    const ranWith = e === null ? undefined : adaptRanWith(e.ran_with);
    const blockers = value.readiness.blockers.map((b): TaskBlocker => {
      check(isRecord(b) && validGraphId(b.edge_id) && validGraphId(b.id) && (b.satisfied === null || typeof b.satisfied === "boolean"));
      check(b.title === undefined || b.title === null || (typeof b.title === "string" && b.title.length <= 1024));
      check(b.task_state === undefined || b.task_state === null || TASK_STATES.includes(b.task_state as string));
      return { edge_id: b.edge_id, id: b.id, title: (b.title as string | null | undefined) ?? null, task_state: (b.task_state as string | null | undefined) ?? null, satisfied: b.satisfied as boolean | null };
    });
    return { state, reported, ...(role ? { role } : {}), reasons, execution: e === null ? null : { attempt_id: e.attempt_id as string, session_id: e.session_id as string, status: e.status as string, ...(ranWith ? { ran_with: ranWith } : {}) }, blockers, complete: value.readiness.complete, parent: adaptGraphParent(value.parent), ...(routing ? { routing } : {}), ...(value.completed_without_changes === true && state === "completed" ? { noChanges: true as const } : {}) };
  });
}

/** One entry of a task's route history (`GET /api/tasks/{id}/routes`, owner-only), newest first; `route` is null for a cleared route. */
export type TaskRouteEntry = { sequence: number; at_ms: number; route: (TaskRouteView & { reasons: { code: string; detail: string }[] }) | null };
export function adaptTaskRoutes(raw: unknown): TaskRouteEntry[] {
  check(isRecord(raw) && Array.isArray(raw.items) && raw.items.length <= 1000);
  return raw.items.map((e): TaskRouteEntry => {
    check(isRecord(e) && Number.isSafeInteger(e.sequence) && (e.sequence as number) > 0 && Number.isSafeInteger(e.at_ms) && (e.at_ms as number) >= 0);
    if (e.route === null) return { sequence: e.sequence as number, at_ms: e.at_ms as number, route: null };
    check(isRecord(e.route) && Array.isArray(e.route.reasons) && e.route.reasons.length <= 32);
    const reasons = e.route.reasons.map(r => { check(isRecord(r) && openEnumValue(r.code) && typeof r.detail === "string" && r.detail.length <= 2000); return { code: r.code as string, detail: r.detail as string }; });
    return { sequence: e.sequence as number, at_ms: e.at_ms as number, route: { ...adaptRoute(e.route), reasons } };
  });
}
/** The route history; read only while the disclosure is open. A 403 (the viewer is not the owner) is an answer, not a fault. */
export function useTaskRoutes(id: string, enabled: boolean) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "task-routes", { id }), enabled: enabled && validGraphId(id), refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
    queryFn: async ({ signal }) => adaptTaskRoutes(await apiGet<unknown>(`/api/tasks/${encodeURIComponent(id)}/routes`, signal)),
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
export type TaskAttempt = { attempt_id: string; session_id: string; holds_task: boolean; status: string; ran_with?: RanWith };
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
      const ranWith = adaptRanWith(a.ran_with);
      return { attempt_id: a.attempt_id, session_id: a.session_id, holds_task: a.holds_task, status: a.status, ...(ranWith ? { ran_with: ranWith } : {}) };
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
