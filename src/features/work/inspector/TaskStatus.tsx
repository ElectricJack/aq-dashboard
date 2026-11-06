import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GraphEnvelope } from "../../../api/adapters/humanGraph";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { TASK_STATUS_LABEL, attemptEnded, unrecognizedLabel, type TaskStatus } from "../labels";
import { StatusIcon } from "../StatusIcon";
import type { HoldReason, TaskAttempt, TaskBlocker, TaskWork, WorkReadiness } from "../taskWork";
import { IdValue, humanize } from "./common";
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
  attempt_finished_stop_unconfirmed: "stop not confirmed",
};

/** The badge's short reason (spec 0004 item 2): only what the server said, most specific first. */
export function statusReason(state: WorkReadiness | undefined, work: TaskWork | undefined): string | null {
  if (!work || !state) return null;
  if (state === "waiting") {
    const open = unsatisfied(work);
    return open.length === 1 ? `blocked by “${blockerName(open[0]!)}”` : open.length ? `blocked by ${open.length} tasks` : null;
  }
  if (state === "held") return HOLD_SHORT[work.reasons[0]?.code ?? ""] ?? null;
  if (state === "unknown") return "relationships not fully read";
  return null;
}

/** Header chip: icon shape + colour, label and the short reason. */
export function StatusBadge({ work, lifecycle, ended = null }: { work: TaskWork | undefined; lifecycle: string | null; ended?: string | null }) {
  const status = headerStatus(work, lifecycle, ended), reason = statusReason(work?.state, work), fallback = heldByFallback(work, ended);
  // Fallback (older server): AQ's "running" stays visible, qualified, because the holding attempt has ended.
  const label = fallback ? `Held by a ${humanize(ended!).toLowerCase()} attempt` : status === "unrecognized" ? unrecognizedLabel(work!.reported) : work ? TASK_STATUS_LABEL[status] : nodeLabel(lifecycle);
  const title = fallback ? "AQ reports this task as running, but the attempt holding it has ended."
    : status === "held" ? work!.reasons.map(r => r.message).join("\n") || undefined
    : status === "unrecognized" ? "AQ reported a readiness state this dashboard version doesn't know." : undefined;
  return <p className={styles.statusChip} data-status={status} data-readiness={work?.reported} data-task-status="" title={title}>
    <StatusIcon status={status} decorative size={16} />
    <span className={styles.statusText}><span className="visually-hidden">Status: </span>{label}{reason && <span className={styles.reason}> · {reason}</span>}</span>
  </p>;
}

/** Status section: why it is (not) running, and the agent holding it (items 2 and 3). */
export function TaskStatusSection({ query, search, linkSearch, ended = null }: { query: UseQueryResult<GraphEnvelope<TaskWork>, unknown>; search: string; linkSearch: string; ended?: string | null }) {
  const work = query.data?.data;
  if (!work) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's readiness" subject="collection" retryLabel="task readiness" onRetry={() => void query.refetch()} />;
  const open = unsatisfied(work);
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
    {work.state === "held" && <p className={styles.reasons}>AQ isn't running this task: an attempt that has stopped or finished still holds it, so no new attempt starts until that claim is released.</p>}
    {work.reasons.length > 0 && <HoldReasons reasons={work.reasons} held={work.state === "held"} holder={work.execution?.attempt_id} />}
    {heldByFallback(work, ended) && <p className={styles.reasons} data-held-reason="">AQ reports this task as running because the attempt below still holds it, but that attempt is {humanize(ended!).toLowerCase()}, so no agent is working on the task now.</p>}
    <TaskAgent work={work} linkSearch={linkSearch} ended={ended} />
  </>;
}

/** AQ's reasons for a hold (`readiness.reasons`), each with the attempt it names unless that is the holder shown below. */
function HoldReasons({ reasons, held, holder }: { reasons: HoldReason[]; held: boolean; holder?: string }) {
  return <div className={styles.reasons}>
    {!held && <p>A stopped attempt still holds this task:</p>}
    <ul aria-label="Why the task is held" className={styles.holdReasons}>{reasons.map(r => <li key={`${r.code}:${r.attempt_id}`} data-hold-reason={r.code}>
      <p>{r.message}</p>
      {r.attempt_id !== holder && <p className={styles.meta}><span>Attempt</span> <IdValue id={r.attempt_id} label="held attempt ID" /> <span className={styles.attemptStatus}>{humanize(r.status)}</span></p>}
    </li>)}</ul>
  </div>;
}

/** The attempt holding the task, with its session's terminal (item 3). Nothing is claimed while unknown. */
function TaskAgent({ work, linkSearch, ended: endedStatus }: { work: TaskWork; linkSearch: string; ended: string | null }) {
  if (!work.execution) return <p className={styles.meta}>No agent attempt holds this task.</p>;
  const e = work.execution;
  // A held task's attempt has stopped even when its status isn't an ended one (stop proof recorded).
  const ended = endedStatus ?? (work.state === "held" ? e.status : null);
  // An ended attempt has no live terminal: the link opens its session record instead.
  return <div className={styles.agent} data-holding-attempt="">
    <p><span>{ended ? "Holding attempt" : "Agent attempt"}</span> <IdValue id={e.attempt_id} label="attempt ID" /> <span className={styles.attemptStatus}>{humanize(ended ?? e.status)}</span></p>
    <p className={styles.agentLinks}><span>Session</span> <IdValue id={e.session_id} label="session ID" />
      <Link className={styles.terminalLink} to={{ pathname: `/agents/${encodeURIComponent(e.session_id)}`, search: linkSearch }}>{ended ? "Open session" : "Open terminal"}</Link></p>
  </div>;
}
