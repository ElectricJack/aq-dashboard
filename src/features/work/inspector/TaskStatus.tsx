import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GraphEnvelope } from "../../../api/adapters/humanGraph";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { TASK_STATUS_LABEL, attemptEnded, type TaskStatus } from "../labels";
import { StatusIcon } from "../StatusIcon";
import type { TaskAttempt, TaskBlocker, TaskWork, WorkReadiness } from "../taskWork";
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

/** Readiness from the work read, or the Graph lifecycle state while it is unknown. "Running" with an ended holder is "held". */
export function headerStatus(work: TaskWork | undefined, lifecycle: string | null, ended: string | null = null): TaskStatus {
  if (work) return work.state === "running" && ended ? "held" : work.state;
  return lifecycle === "draft" || lifecycle === "completed" || lifecycle === "canceled" ? lifecycle : lifecycle === "active" ? "active" : "unknown";
}
/** Blockers that keep the task waiting: not completed (false), or not in the read Context (null). */
export const unsatisfied = (work: TaskWork) => work.blockers.filter(b => b.satisfied !== true);
const blockerName = (b: TaskBlocker) => b.title ?? `task ${b.id.slice(0, 8)}`;

/** The badge's short reason (spec 0004 item 2): only what the server said, most specific first. */
export function statusReason(state: WorkReadiness | undefined, work: TaskWork | undefined): string | null {
  if (!work || !state) return null;
  if (state === "waiting") {
    const open = unsatisfied(work);
    return open.length === 1 ? `blocked by “${blockerName(open[0]!)}”` : open.length ? `blocked by ${open.length} tasks` : null;
  }
  if (state === "unknown") return "relationships not fully read";
  return null;
}

/** Header chip: icon shape + colour, label and the short reason. */
export function StatusBadge({ work, lifecycle, ended = null }: { work: TaskWork | undefined; lifecycle: string | null; ended?: string | null }) {
  const status = headerStatus(work, lifecycle, ended), reason = statusReason(work?.state, work);
  // The server's readiness stays visible, qualified: AQ says running, but the holding attempt has ended.
  const label = status === "held" ? `Held by a ${humanize(ended!).toLowerCase()} attempt` : work ? TASK_STATUS_LABEL[status] : nodeLabel(lifecycle);
  return <p className={styles.statusChip} data-status={status} data-readiness={work?.state} data-task-status=""
    title={status === "held" ? "AQ reports this task as running, but the attempt holding it has ended." : undefined}>
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
    {work.state === "draft" && <p className={styles.reasons}>This task is a draft. AQ doesn't start attempts for drafts.</p>}
    {work.state === "running" && ended && <p className={styles.reasons} data-held-reason="">AQ reports this task as running because the attempt below still holds it, but that attempt is {humanize(ended).toLowerCase()}, so no agent is working on the task now.</p>}
    <TaskAgent work={work} linkSearch={linkSearch} ended={ended} />
  </>;
}

/** The attempt holding the task, with its session's terminal (item 3). Nothing is claimed while unknown. */
function TaskAgent({ work, linkSearch, ended }: { work: TaskWork; linkSearch: string; ended: string | null }) {
  if (!work.execution) return <p className={styles.meta}>No agent attempt holds this task.</p>;
  const e = work.execution;
  // An ended attempt has no live terminal: the link opens its session record instead.
  return <div className={styles.agent} data-holding-attempt="">
    <p><span>{ended ? "Holding attempt" : "Agent attempt"}</span> <IdValue id={e.attempt_id} label="attempt ID" /> <span className={styles.attemptStatus}>{humanize(ended ?? e.status)}</span></p>
    <p className={styles.agentLinks}><span>Session</span> <IdValue id={e.session_id} label="session ID" />
      <Link className={styles.terminalLink} to={{ pathname: `/agents/${encodeURIComponent(e.session_id)}`, search: linkSearch }}>{ended ? "Open session" : "Open terminal"}</Link></p>
  </div>;
}
