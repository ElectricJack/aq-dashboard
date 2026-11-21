import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GraphEnvelope } from "../../../api/adapters/humanGraph";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { TASK_STATUS_LABEL, attemptEnded, unrecognizedLabel, type TaskStatus } from "../labels";
import { StatusIcon } from "../StatusIcon";
import type { HoldReason, StartupOverLimit, TaskAttempt, TaskBlocker, TaskRole, TaskWork, WorkReadiness } from "../taskWork";
import { roleSourceLabel, useTaskRoles } from "../taskRole";
import { IdValue, RanWithLine, humanize } from "./common";
import { TaskRoute } from "./TaskRoute";
import styles from "./Inspector.module.css";

/**
 * The status of the attempt holding the task when that attempt has ended (P1-01), from the work read's
 * `execution.status` or, when the history read is loaded, the same attempt's status there; null otherwise.
 */
export function endedHolder(work: TaskWork | undefined, attempts?: readonly TaskAttempt[]): string | null {
  const e = work?.execution;
  if (!e) return null;
  if (attemptEnded(e.status)) return e.status;
  const recorded = attempts?.find(a => a.attempt_id === e.attempt_id);
  return recorded && attemptEnded(recorded.status) ? recorded.status : null;
}

/**
 * Readiness from the work read, or the Graph lifecycle state while it is unknown. AQ says `held` itself since
 * aq-server #99; for an older server, "running" with an ended holder is still shown as held (the P1-01 fallback).
 */
export function headerStatus(work: TaskWork | undefined, lifecycle: string | null, ended: string | null = null): TaskStatus {
  if (work) return work.state === "running" && ended ? "held" : work.state;
  return lifecycle === "draft" || lifecycle === "completed" || lifecycle === "canceled" ? lifecycle : lifecycle === "active" ? "active" : "unknown";
}
/** True when the client-side fallback, not AQ, decided the task is held (a server without `held`). */
export const heldByFallback = (work: TaskWork | undefined, ended: string | null) => work?.state === "running" && !!ended;
/** Blockers that keep the task waiting: not completed (false), or not in the read Context (null). */
export const unsatisfied = (work: TaskWork) => work.blockers.filter(b => b.satisfied !== true);
const blockerName = (b: TaskBlocker) => b.title ?? `task ${b.id.slice(0, 8)}`;

/** A hold's short reason for the badge, by code; a code this bundle doesn't know shows its message in Status only. */
const HOLD_SHORT: Record<string, string> = {
  cancelled_attempt_holds_task: "cancelled attempt holds it",
  attempt_stopped_not_released: "stopped attempt not released",
  result_ready: "awaiting delivery",
  result_ready_no_delivery_policy: "no active delivery policy",
  attempt_finished_stop_unconfirmed: "stop not confirmed",
  role_disabled: "its role is disabled", role_missing: "its role does not exist", level_missing: "its level does not exist",
  startup_over_limit: "startup text over its limit", platform_text_missing: "no platform text for its environment",
};
const count = (n: number) => n.toLocaleString("en-US");
/** "70,112 of 65,536 bytes": the startup text's size and the limit it is over. */
export const startupNumbers = (s: StartupOverLimit) => `${count(s.bytes)} of ${count(s.limit)} bytes`;
/** Which limit that is: the execution profile's, or the project's ceiling. */
const startupLimit = (s: StartupOverLimit) => s.limiting === "project_context_bytes" ? "the project's context_bytes ceiling" : `startup_context_bytes of execution profile ${s.execution_profile}`;

/** The badge's short reason (spec 0004 item 2): only what the server said, most specific first. */
export function statusReason(state: WorkReadiness | undefined, work: TaskWork | undefined): string | null {
  if (!work || !state) return null;
  if (state === "waiting") {
    const open = unsatisfied(work);
    return open.length === 1 ? `blocked by “${blockerName(open[0]!)}”` : open.length ? `blocked by ${open.length} tasks` : null;
  }
  if (state === "held") {
    const first = work.reasons.find(r => r.code === "task_held")
      ?? work.reasons.find(r => r.result_id && r.attempt_id === work.execution?.attempt_id)
      ?? work.reasons[0];
    if (first?.hold_reason) return humanize(first.hold_reason).toLowerCase();
    const short = HOLD_SHORT[first?.code ?? ""] ?? null;
    return short && first?.startup ? `${short} (${startupNumbers(first.startup)})` : short;
  }
  if (state === "unknown") return "relationships not fully read";
  return null;
}

/** Header chip: icon shape + colour, label and the short reason. */
export function StatusBadge({ work, lifecycle, ended = null }: { work: TaskWork | undefined; lifecycle: string | null; ended?: string | null }) {
  const status = headerStatus(work, lifecycle, ended), reason = statusReason(work?.state, work), fallback = heldByFallback(work, ended);
  // Fallback (older server): AQ's "running" stays visible, qualified, because the holding attempt has ended.
  const label = fallback ? `Held by a ${humanize(ended!).toLowerCase()} attempt` : status === "unrecognized" ? unrecognizedLabel(work!.reported) : status === "completed" && work?.noChanges ? "Completed, no changes" : work ? TASK_STATUS_LABEL[status] : nodeLabel(lifecycle);
  const title = fallback ? "AQ reports this task as running, but the attempt holding it has ended."
    : status === "held" ? work!.reasons.map(r => r.message).join("\n") || undefined
    : status === "unrecognized" ? "AQ reported a readiness state this dashboard version doesn't know." : undefined;
  return <p className={styles.statusChip} data-status={status} data-readiness={work?.reported} data-task-status="" title={title}>
    <StatusIcon status={status} decorative size={16} />
    <span className={styles.statusText}><span className="visually-hidden">Status: </span>{label}{reason && <span className={styles.reason}> · {reason}</span>}</span>
  </p>;
}

/** Status section: why it is (not) running, and the agent holding it (items 2 and 3). */
export function TaskStatusSection({ query, taskId, search, linkSearch, ended = null }: { query: UseQueryResult<GraphEnvelope<TaskWork>, unknown>; taskId: string; search: string; linkSearch: string; ended?: string | null }) {
  const work = query.data?.data;
  if (!work) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's readiness" subject="collection" retryLabel="task readiness" onRetry={() => void query.refetch()} />;
  const open = unsatisfied(work);
  const holder = work.execution?.attempt_id;
  const recorded = work.reasons.some(r => r.result_id && r.attempt_id === holder);
  const reasons = recorded
    ? work.reasons.filter(r => r.code !== "attempt_stopped_not_released" || r.attempt_id !== holder)
    : work.reasons;
  return <>
    <RetainedNotice query={query} />
    {work.state === "waiting" && open.length > 0 && <div className={styles.reasons}>
      <p>Waiting for {open.length === 1 ? "a blocker" : `${open.length} blockers`} to complete:</p>
      <ul aria-label="Unsatisfied blockers">{open.map(b => <li key={b.edge_id}>
        <StatusIcon status="waiting" decorative size={14} />
        <Link to={{ pathname: `/work/${encodeURIComponent(b.id)}`, search }}>{blockerName(b)}</Link>
        <span className={styles.meta}>{b.satisfied === null ? "state not in this read" : nodeLabel(b.task_state)}</span>
      </li>)}</ul>
    </div>}
    {work.state === "unknown" && <p className={styles.reasons}>AQ couldn't read every relationship of this task, so it can't say whether the task is ready.</p>}
    {work.state === "unrecognized" && <p className={styles.reasons} data-unrecognized-readiness="">AQ reported the readiness “{work.reported}”, which this dashboard version doesn't know, so it doesn't say whether the task is running or ready. Update the dashboard to see what it means.</p>}
    {work.state === "draft" && <p className={styles.reasons}>This task is a draft. AQ doesn't start attempts for drafts.</p>}
    {/* Role and route share a line; a task without a route to show has the role alone. */}
    {work.routing && work.routing.state !== "unrouted" ? <TaskRoute routing={work.routing} taskId={taskId} lead={work.role && <RoleLine role={work.role} />} /> : work.role && <RoleLine role={work.role} />}
    {/* A role or level hold says why in AQ's own words below; this sentence is for a claim an attempt still holds. */}
    {work.state === "held" && !recorded && (work.reasons.length === 0 || work.reasons.some(r => r.attempt_id)) && <p className={styles.reasons}>AQ isn't running this task: an attempt that has stopped or finished still holds it, so no new attempt starts until that claim is released.</p>}
    {reasons.length > 0 && <HoldReasons reasons={reasons} held={work.state === "held"} holder={holder} />}
    {heldByFallback(work, ended) && <p className={styles.reasons} data-held-reason="">AQ reports this task as running because the attempt below still holds it, but that attempt is {humanize(ended!).toLowerCase()}, so no agent is working on the task now.</p>}
    <TaskAgent work={work} linkSearch={linkSearch} ended={ended} />
  </>;
}

/** The task's role and where it comes from: "Developer · project default" or "Reviewer · set on this task". The name is the one Settings gives the role. */
function RoleLine({ role }: { role: TaskRole }) {
  const roles = useTaskRoles();
  return <p className={styles.roleLine} data-task-role={role.id} data-role-source={role.source}><span><span className={styles.meta}>Role</span> <strong>{roles.name(role.id)}</strong> · {roleSourceLabel(role.source)}</span></p>;
}

/**
 * AQ's reasons for a hold (`readiness.reasons`) in its own words. A reason about an attempt names it unless that is the
 * holder shown below; a role or level hold (`role_disabled`, `role_missing`, `level_missing`) has no attempt, and neither
 * has a refused offer (`startup_over_limit`, with its two numbers on a line of their own, and `platform_text_missing`).
 */
function HoldReasons({ reasons, held, holder }: { reasons: HoldReason[]; held: boolean; holder?: string }) {
  return <div className={styles.reasons}>
    {!held && reasons.some(r => r.attempt_id) && <p>A stopped attempt still holds this task:</p>}
    <ul aria-label="Why the task is held" className={styles.holdReasons}>{reasons.map(r => <li key={`${r.code}:${r.attempt_id ?? r.role ?? r.level ?? ""}`} data-hold-reason={r.code}>
      <p>{r.message}</p>
      {r.startup && <p className={styles.meta} data-startup-over-limit=""><span>Startup text <strong>{startupNumbers(r.startup)}</strong> · the limit is {startupLimit(r.startup)}</span></p>}
      {r.result_id && <p className={styles.meta}>Result <IdValue id={r.result_id} label="result ID" /></p>}
      {r.attempt_id && r.attempt_id !== holder && <p className={styles.meta}><span>Attempt</span> <IdValue id={r.attempt_id} label="held attempt ID" /> {r.status && <span className={styles.attemptStatus}>{humanize(r.status)}</span>}</p>}
    </li>)}</ul>
  </div>;
}

/** The attempt holding the task, with its session's terminal (item 3). Nothing is claimed while unknown. */
function TaskAgent({ work, linkSearch, ended: endedStatus }: { work: TaskWork; linkSearch: string; ended: string | null }) {
  if (!work.execution) return <p className={styles.meta}>No agent attempt holds this task.</p>;
  const e = work.execution;
  // A held task's attempt has stopped even when its status isn't an ended one (stop proof recorded).
  const ended = endedStatus ?? (work.state === "held" ? e.status : null);
  // An ended attempt has no live terminal: the link opens its session record instead. The attempt, its session and that
  // link share one line (it wraps where the inspector is narrow), and what the attempt ran with has the next (density 2026-11-17).
  return <div className={styles.agent} data-holding-attempt="">
    <p className={styles.agentHead}><span>{ended ? "Holding attempt" : "Agent attempt"}</span> <IdValue id={e.attempt_id} label="attempt ID" /> <span className={styles.attemptStatus}>{humanize(ended ?? e.status)}</span>
      <span className={styles.agentSession}><span>Session</span> <IdValue id={e.session_id} label="session ID" /></span>
      <Link className={styles.terminalLink} to={{ pathname: `/agents/${encodeURIComponent(e.session_id)}`, search: linkSearch }}>{ended ? "Open session" : "Open terminal"}</Link></p>
    {e.ran_with && <RanWithLine ranWith={e.ran_with} />}
  </div>;
}
