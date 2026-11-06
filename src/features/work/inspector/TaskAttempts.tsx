import { useState } from "react";
import { Link } from "react-router";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { useSession } from "../../../app/session";
import { useAttemptSession, type TaskAttempt, type useTaskHistory } from "../taskWork";
import { Ago, IdValue, NotOffered, humanize } from "./common";
import { ShowAll } from "./Section";
import styles from "./Inspector.module.css";

export const ATTEMPTS_PREVIEW = 3;

/** Attempts from the history read (item 4): the holding attempt first, then the rest as AQ lists them. */
export function TaskAttempts({ query, linkSearch }: { query: ReturnType<typeof useTaskHistory>; linkSearch: string }) {
  const [all, setAll] = useState(false);
  const { bootstrap } = useSession();
  const page = query.data?.pages[0]?.data;
  if (!page) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's attempts" subject="collection" retryLabel="task attempts" onRetry={() => void query.refetch()} />;
  if (!page.attempts.length) return <p className={styles.meta}>This task has never had an agent attempt.</p>;
  const shown = all ? page.attempts : page.attempts.slice(0, ATTEMPTS_PREVIEW);
  const sessions = bootstrap.capability("sessions.read");
  return <>
    <RetainedNotice query={query} />
    {!sessions.enabled && <NotOffered what="Session details" reason={sessions.reason} />}
    <ol className={styles.attempts} aria-label="Attempts">{shown.map(a => <AttemptRow key={a.attempt_id} attempt={a} linkSearch={linkSearch} sessions={sessions.enabled} />)}</ol>
    <ShowAll shown={ATTEMPTS_PREVIEW} total={page.attempts.length} noun="attempts" expanded={all} onShowAll={setAll} />
    {page.attempts_truncated && <p className={styles.meta}>AQ recorded more than {page.attempts.length} attempts; only these are shown.</p>}
  </>;
}

function AttemptRow({ attempt: a, linkSearch, sessions }: { attempt: TaskAttempt; linkSearch: string; sessions: boolean }) {
  const session = useAttemptSession(a.session_id, sessions), s = session.data;
  const profile = s ? [["provider", s.profile.provider], ["model", s.profile.model], ["harness", s.profile.harness]] as const : null;
  return <li className={styles.attempt} data-attempt={a.attempt_id}>
    <p className={styles.attemptHead}>
      <span>Attempt</span> <IdValue id={a.attempt_id} label="attempt ID" />
      <span className={styles.attemptStatus}>{humanize(a.status)}</span>
      {a.holds_task && <span className={styles.badge}>Holds the task</span>}
    </p>
    {sessions && (profile
      ? <p className={styles.meta} data-attempt-profile="">{profile.map(([name, value], i) => <span key={name}>{i > 0 && " · "}{value ?? `${name} not reported`}</span>)}</p>
      : <p className={styles.meta}>{session.isError ? "Session details unavailable." : "Reading session details…"}</p>)}
    {s && <p className={styles.meta} data-attempt-times="">
      {s.lifecycle?.startedAt ? <>Started <Ago at={s.lifecycle.startedAt} /></> : "Start not recorded"}
      {" · "}{s.lifecycle?.stoppedAt ? <>Stopped <Ago at={s.lifecycle.stoppedAt} /></> : "No stop recorded"}
    </p>}
    <p className={styles.agentLinks}><span>Session</span> <IdValue id={a.session_id} label="session ID" />
      <Link to={{ pathname: `/agents/${encodeURIComponent(a.session_id)}`, search: linkSearch }} aria-label={`Open session ${a.session_id.slice(0, 8)}`}>Open session</Link></p>
  </li>;
}
