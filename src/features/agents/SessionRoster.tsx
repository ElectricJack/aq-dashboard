import { Link } from "react-router";
import { adaptSession, type SessionView } from "../../api/adapters/inspection";
import type { SessionSummary } from "../../api/wire/proposed";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { formatAge } from "../../components/time/relative";
import { useScope } from "../../app/scope";
import { usePagedRead } from "../../app/usePagedRead";
import { AUTHORITY_LABEL, controllerText, executionAuthorityText, profileText } from "./labels";
import { ObservationSummary, ObservationTimes } from "./ObservationState";
import styles from "./Agents.module.css";

const ROSTER_POLL_MS = 10_000;
/** Preserve user labels. The server's UUID fallback ("Remote session <uuid>") says nothing in a narrow tab,
 * so compact chrome leads with the task title when one is recorded, else the short session id (RA-13). */
export function compactSessionLabel(s: SessionView): string {
  const fallback = ["Remote session", "Central session", "Session"].some(
    (prefix) => s.label === `${prefix} ${s.id}`,
  );
  if (!fallback) return s.label;
  const title = s.task?.title && s.task.title !== s.task.id ? s.task.title : null;
  return title ?? `Session ${s.id.slice(0, 8)}`;
}

export function LifecycleHistory({ session, serverTime }: { session: SessionView; serverTime: string }) {
  const history = session.lifecycle;
  if (!history) return <span>Lifecycle history unavailable</span>;
  if (!history.startedAt && !history.stoppedAt) return <span>No worker lifecycle reports</span>;
  return (
    <span>
      {history.startedAt && (
        <>
          Start recorded{" "}
          <time dateTime={history.startedAt} title={history.startedAt}>
            {formatAge(serverTime, history.startedAt)}
          </time>
        </>
      )}
      {history.stoppedAt && (
        <>
          {" "}
          · Stop recorded{" "}
          <time dateTime={history.stoppedAt} title={history.stoppedAt}>
            {formatAge(serverTime, history.stoppedAt)}
          </time>
        </>
      )}
    </span>
  );
}

function RosterRow({ s, search, serverTime }: { s: SessionView; search: string; serverTime: string }) {
  return (
    <li className={styles.row} data-state={s.observation.state} data-session-id={s.id}>
      <Link to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }} className={styles.rowLink}>
        {s.label}
      </Link>
      <span className={styles.meta}>
        {s.task?.title ?? "No task"} · {s.project.label} · {AUTHORITY_LABEL[s.authority]}
      </span>
      <span className={styles.meta}>{profileText(s.profile)}</span>
      <span className={styles.state}>
        <ObservationSummary session={s} serverTime={serverTime} />
      </span>
      <ObservationTimes session={s} serverTime={serverTime} />
      <span className={styles.meta}>Central state: {executionAuthorityText(s.executionAuthority)}</span>
      <span className={styles.meta}>
        <LifecycleHistory session={s} serverTime={serverTime} />
      </span>
      <span className={styles.meta}>
        {controllerText(s.controller)}
        {s.wait && <> · {s.wait.explanation}</>}
      </span>
    </li>
  );
}

export function SessionRoster({ search }: { search: string }) {
  const [scope] = useScope();
  const query = usePagedRead<SessionSummary, SessionView>({
    resource: "sessions",
    path: "/api/v1/sessions",
    scope,
    params: { limit: 25 },
    adapt: adaptSession,
    pollMs: ROSTER_POLL_MS,
  });
  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="sessions"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const pages = query.data.pages;
  const sessions = pages.flatMap((p) => p.page.items);
  const serverTime = pages[pages.length - 1]!.serverTime;
  const complete = pages.every((p) => p.coverage.state === "complete");
  // The server's own words for what the roster can't see yet (RA-18).
  const coverageReason = [
    ...new Set(pages.map((p) => p.coverage.reason?.trim().replace(/\.$/, "")).filter(Boolean)),
  ].join(". ");

  return (
    <div className={styles.roster}>
      {!complete && (
        <p className={styles.warning}>
          This roster has partial coverage. Some sessions may be missing.
          {coverageReason && <> {coverageReason}.</>}
        </p>
      )}
      <RetainedNotice query={query} />
      {sessions.length === 0 ? (
        <p className={styles.muted}>
          {complete ? "No active sessions" : "No sessions returned in this scope."}
        </p>
      ) : (
        <ul aria-label="Sessions" className={styles.list}>
          {sessions.map((s) => (
            <RosterRow key={s.id} s={s} search={search} serverTime={serverTime} />
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button type="button" className={styles.secondary} onClick={() => void query.fetchNextPage()}>
          Load more sessions
        </button>
      )}
    </div>
  );
}

/** The switcher's roster read; the split view's second pane picks from the same cached pages. */
export function useSessionRoster() {
  const [scope] = useScope();
  const query = usePagedRead<SessionSummary, SessionView>({
    resource: "sessions",
    path: "/api/v1/sessions",
    scope,
    params: { limit: 25 },
    adapt: adaptSession,
    pollMs: ROSTER_POLL_MS,
  });
  return { query, sessions: query.data?.pages.flatMap((p) => p.page.items).slice(0, 100) ?? [] };
}
