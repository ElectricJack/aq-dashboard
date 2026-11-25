import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GraphEnvelope } from "../../../api/adapters/humanGraph";
import { nodeLabel } from "../../../api/adapters/humanGraph";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { StatusIcon } from "../StatusIcon";
import type { HoldReason, TaskRole, TaskWork } from "../taskWork";
import { roleSourceLabel, useTaskRoles } from "../taskRole";
import { IdValue, RanWithLine, humanize } from "./common";
import { TaskRoute } from "./TaskRoute";
import styles from "./Inspector.module.css";

import { badgeText, blockerName, holdEvidence, heldByFallback, startupLimit, startupNumbers, statusReason, unsatisfied } from "./taskStatusLabels";
export { endedHolder, headerStatus, heldByFallback, startupNumbers, statusReason, unsatisfied } from "./taskStatusLabels";

/** Header chip: icon shape + colour, label and the short reason. */
export function StatusBadge({ work, lifecycle, ended = null }: { work: TaskWork | undefined; lifecycle: string | null; ended?: string | null }) {
  const reason = statusReason(work?.state, work);
  const { status, label, title } = badgeText(work, lifecycle, ended);
  return <p className={styles.statusChip} data-status={status} data-readiness={work?.reported} data-task-status="" title={title}>
    <StatusIcon status={status} decorative size={16} />
    <span className={styles.statusText}><span className="visually-hidden">Status: </span>{label}{reason && <span className={styles.reason}> · {reason}</span>}</span>
  </p>;
}

/** Status section: why it is (not) running, and the agent holding it (items 2 and 3). */
export function TaskStatusSection({ query, taskId, search, linkSearch, ended = null }: { query: UseQueryResult<GraphEnvelope<TaskWork>, unknown>; taskId: string; search: string; linkSearch: string; ended?: string | null }) {
  const work = query.data?.data;
  if (!work) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's readiness" subject="collection" retryLabel="task readiness" onRetry={() => void query.refetch()} />;
  return <>
    <RetainedNotice query={query} />
    <ReadinessExplanation work={work} search={search} />
    <RoleRoute work={work} taskId={taskId} />
    <HeldExplanation work={work} />
    {heldByFallback(work, ended) && <p className={styles.reasons} data-held-reason="">AQ reports this task as running because the attempt below still holds it, but that attempt is {humanize(ended!).toLowerCase()}, so no agent is working on the task now.</p>}
    <TaskAgent work={work} linkSearch={linkSearch} ended={ended} />
  </>;
}

function ReadinessExplanation({ work, search }: { work: TaskWork; search: string }) {
  switch (work.state) {
    case "waiting": return <WaitingBlockers work={work} search={search} />;
    case "unknown": return <p className={styles.reasons}>AQ couldn't read every relationship of this task, so it can't say whether the task is ready.</p>;
    case "unrecognized": return <p className={styles.reasons} data-unrecognized-readiness="">AQ reported the readiness “{work.reported}”, which this dashboard version doesn't know, so it doesn't say whether the task is running or ready. Update the dashboard to see what it means.</p>;
    case "draft": return <p className={styles.reasons}>This task is a draft. AQ doesn't start attempts for drafts.</p>;
    default: return null;
  }
}

function WaitingBlockers({ work, search }: { work: TaskWork; search: string }) {
  const open = unsatisfied(work);
  if (!open.length) return null;
  return <div className={styles.reasons}>
      <p>Waiting for {open.length === 1 ? "a blocker" : `${open.length} blockers`} to complete:</p>
      <ul aria-label="Unsatisfied blockers">{open.map(b => <li key={b.edge_id}>
        <StatusIcon status="waiting" decorative size={14} />
        <Link to={{ pathname: `/work/${encodeURIComponent(b.id)}`, search }}>{blockerName(b)}</Link>
        <span className={styles.meta}>{b.satisfied === null ? "state not in this read" : nodeLabel(b.task_state)}</span>
      </li>)}</ul>
    </div>;
}

function RoleRoute({ work, taskId }: { work: TaskWork; taskId: string }) {
  const role = work.role && <RoleLine role={work.role} />;
  if (!work.routing || work.routing.state === "unrouted") return role;
  return <TaskRoute routing={work.routing} taskId={taskId} lead={role} />;
}

function HeldExplanation({ work }: { work: TaskWork }) {
  const { holder, reasons, explainClaim } = holdEvidence(work);
  return <>
    {/* A role or level hold says why in AQ's own words below; this sentence is for a claim an attempt still holds. */}
    {explainClaim && <p className={styles.reasons}>AQ isn't running this task: an attempt that has stopped or finished still holds it, so no new attempt starts until that claim is released.</p>}
    {reasons.length > 0 && <HoldReasons reasons={reasons} held={work.state === "held"} holder={holder} />}
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
    <ul aria-label="Why the task is held" className={styles.holdReasons}>
      {reasons.map(reason => <HoldReasonRow key={reasonKey(reason)} reason={reason} holder={holder} />)}
    </ul>
  </div>;
}

function reasonKey(reason: HoldReason) {
  return `${reason.code}:${reason.attempt_id ?? reason.role ?? reason.level ?? ""}`;
}

function HoldReasonRow({ reason: r, holder }: { reason: HoldReason; holder?: string }) {
  return <li data-hold-reason={r.code}>
      <p>{r.message}</p>
      {r.startup && <p className={styles.meta} data-startup-over-limit=""><span>Startup text <strong>{startupNumbers(r.startup)}</strong> · the limit is {startupLimit(r.startup)}</span></p>}
      {r.result_id && <p className={styles.meta}>Result <IdValue id={r.result_id} label="result ID" /></p>}
      {r.attempt_id && r.attempt_id !== holder && <p className={styles.meta}><span>Attempt</span> <IdValue id={r.attempt_id} label="held attempt ID" /> {r.status && <span className={styles.attemptStatus}>{humanize(r.status)}</span>}</p>}
    </li>;
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
