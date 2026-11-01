import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  adaptSession,
  adaptSessionDetail,
  type SessionDetailView,
  type SessionView,
} from "../../api/adapters/inspection";
import type { SessionDetail as SessionDetailWire, SessionSummary } from "../../api/wire/proposed";
import { FreshnessLabel } from "../../components/QueryStatus/FreshnessLabel";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { formatAge } from "../../components/time/relative";
import { scopeSearch, useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { usePagedRead } from "../../app/usePagedRead";
import { useRead } from "../../app/useRead";
import { AUTHORITY_LABEL, controllerText, executionAuthorityText, OBSERVATION_LABEL, profileText } from "./labels";
import styles from "./Agents.module.css";
import { TerminalTail } from "./TerminalTail";
import { ActionButton, DetailList, Toolbar } from "../../components/layout/Workspace";

/** Initial budgets from docs/plans/0001 §2. */
const ROSTER_POLL_MS = 10_000;
const DETAIL_POLL_MS = 5_000;

function LifecycleHistory({ session, serverTime }: { session: SessionView; serverTime: string }) {
  const history = session.lifecycle;
  if (!history) return <span>Lifecycle history unavailable</span>;
  if (!history.startedAt && !history.stoppedAt) return <span>No worker lifecycle reports</span>;
  return <span>
    {history.startedAt && <>Start recorded <time dateTime={history.startedAt} title={history.startedAt}>{formatAge(serverTime, history.startedAt)}</time></>}
    {history.stoppedAt && <> · Stop recorded <time dateTime={history.stoppedAt} title={history.stoppedAt}>{formatAge(serverTime, history.stoppedAt)}</time></>}
  </span>;
}

function Roster({ search }: { search: string }) {
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

  return (
    <div className={styles.roster}>
      {!complete && <p className={styles.warning}>This roster has partial coverage. Some sessions may be missing.</p>}
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}
      {sessions.length === 0 ? (
        complete && <p className={styles.muted}>No active sessions</p>
      ) : (
        <ul aria-label="Sessions" className={styles.list}>
          {sessions.map((s) => (
            <li key={s.id} className={styles.row} data-state={s.observation.state} data-session-id={s.id}>
              <Link to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }} className={styles.rowLink}>
                {s.label}
              </Link>
              <span className={styles.meta}>
                {s.task?.title ?? "No task"} · {s.project.label} · {AUTHORITY_LABEL[s.authority]}
              </span>
              <span className={styles.meta}>{profileText(s.profile)}</span>
              <span className={styles.state}>
                {OBSERVATION_LABEL[s.observation.state]} ·{" "}
                <FreshnessLabel
                  serverTime={serverTime}
                  observedAt={s.observation.observedAt}
                  stale={s.observation.freshness === "stale"}
                />
              </span>
              <span className={styles.meta}>Central state: {executionAuthorityText(s.executionAuthority)}</span>
              <span className={styles.meta}><LifecycleHistory session={s} serverTime={serverTime} /></span>
              <span className={styles.meta}>
                {controllerText(s.controller)}
                {s.wait && <> · {s.wait.explanation}</>}
              </span>
            </li>
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

function SessionSwitcher({ selected, search }: { selected: SessionView; search: string }) {
  const [scope] = useScope();
  const query = usePagedRead<SessionSummary, SessionView>({ resource: "sessions", path: "/api/v1/sessions", scope,
    params: { limit: 25 }, adapt: adaptSession, pollMs: ROSTER_POLL_MS });
  const sessions = query.data?.pages.flatMap(p => p.page.items).slice(0, 100) ?? [];
  return <nav className={styles.switcher} aria-label="Session switcher">
    {sessions.length === 0 && <span className={styles.sessionTab} aria-current="page">{selected.label}</span>}
    {sessions.map(s => <Link key={s.id} title={s.label} className={styles.sessionTab} aria-current={s.id === selected.id ? "page" : undefined}
      to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }}><span className={styles.sessionDot} aria-hidden="true" />{s.label}</Link>)}
    {sessions.length > 0 && !sessions.some(s => s.id === selected.id) && <span className={styles.sessionTab} aria-current="page">{selected.label}</span>}
    {query.hasNextPage && sessions.length < 100 && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>More sessions</ActionButton>}
    {query.isError && <span className={styles.muted}>Session switcher unavailable</span>}
  </nav>;
}

function SessionPage({ sessionId, search }: { sessionId: string; search: string }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const terminal = bootstrap.capability("terminal.watch");
  const taskView = bootstrap.capability("tasks.read");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const query = useRead<SessionDetailWire, SessionDetailView>({
    resource: "session",
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    scope,
    params: {},
    adapt: adaptSessionDetail,
    pollMs: DETAIL_POLL_MS,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useLocation().key !== "default";
  const loaded = query.data?.view.id;
  useEffect(() => {
    if (navigated && loaded === sessionId) heading.current?.focus();
  }, [navigated, loaded, sessionId]);

  if (!query.data) {
    return (
      <QueryStatus
        status={query.isError ? "error" : "pending"}
        error={query.error}
        label="this session"
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { view: s, serverTime } = query.data;
  const headingId = `session-${s.id}-heading`;

  return (
    <section className={styles.detail} aria-labelledby={headingId}>
      <Toolbar className={styles.workspaceHeading}>
        <Link to={{ pathname: "/agents", search }} className={styles.back}>All sessions</Link>
        <span className={styles.focusLabel}>Focused workspace · Read only</span>
        <ActionButton aria-expanded={detailsOpen} aria-controls={`session-${s.id}-details`} onClick={() => setDetailsOpen(v => !v)}>Session details</ActionButton>
      </Toolbar>
      <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.title}>
        {s.label}
      </h2>
      <p className={styles.meta}>
        {s.task && taskView.enabled ? (
          <Link to={{ pathname: `/work/${encodeURIComponent(s.task.id)}`, search }}>{s.task.title}</Link>
        ) : (
          s.task?.title ?? "No task"
        )}{" "}
        · {s.project.label} · {OBSERVATION_LABEL[s.observation.state]} ·{" "}
        <FreshnessLabel serverTime={serverTime} observedAt={s.observation.observedAt} stale={s.observation.freshness === "stale"} />
      </p>
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}

      <SessionSwitcher selected={s} search={search} />
      <div className={styles.outputWorkspace}>
        <Toolbar className={styles.outputHeading}><strong>{s.profile.provider ?? "Provider unknown"} · {profileText(s.profile)}</strong><span className={styles.readOnly}>Read only</span></Toolbar>
      {s.terminal && terminal.enabled ? <TerminalTail key={s.terminal.id} terminalId={s.terminal.id} /> : <div className={styles.terminal} role="note">
        <strong>Terminal is not available</strong>
        <span>{terminal.enabled ? "Watching and control are not connected yet." : terminal.reason}</span>
      </div>}

      <footer className={styles.outputFooter}><span>{OBSERVATION_LABEL[s.observation.state]}</span><span>Central state: {executionAuthorityText(s.executionAuthority)}</span><span>{s.lastActivityAt ? `Last activity ${formatAge(serverTime, s.lastActivityAt)}` : "Last activity unknown"}</span></footer>
      </div>

      <div id={`session-${s.id}-details`} className={styles.detailsPanel} hidden={!detailsOpen}>
      <DetailList>
        <dt>Authority location</dt>
        <dd>{AUTHORITY_LABEL[s.authority]}</dd>
        <dt>Central execution state</dt>
        <dd>{executionAuthorityText(s.executionAuthority)}</dd>
        <dt>Configured provider</dt>
        <dd>{s.profile.provider ?? "Unknown"}</dd>
        <dt>Configured model and harness</dt>
        <dd>{profileText(s.profile)}</dd>
        <dt>Controller</dt>
        <dd>{controllerText(s.controller)}</dd>
        <dt>Last activity</dt>
        <dd>{s.lastActivityAt ? formatAge(serverTime, s.lastActivityAt) : "Unknown"}</dd>
        <dt>Attempt</dt>
        <dd>{s.attemptId ?? "None"}</dd>
      </DetailList>

      <h3>Worker lifecycle history</h3>
      <p><LifecycleHistory session={s} serverTime={serverTime} /></p>
      <p className={styles.muted}>Recorded lifecycle reports are historical evidence. Live process observation remains separate.</p>

      <h3>Profile revisions</h3>
      <ul aria-label="Profile revisions" className={styles.bullets}>
        {s.profileRevisions.map((p) => (
          <li key={p.name}>
            {p.name} · revision {p.revision}
          </li>
        ))}
      </ul>
      <h3>Permissions</h3>
      <ul aria-label="Permissions" className={styles.bullets}>
        {s.permissions.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      </div>
    </section>
  );
}

export function Agents() {
  const { sessionId } = useParams();
  const [scope] = useScope();
  const search = scopeSearch(scope);
  const container = useRef<HTMLDivElement>(null);
  const lastSelected = useRef<string | null>(null);
  // Back from a session returns focus to the roster row that opened it.
  useEffect(() => {
    if (sessionId) {
      lastSelected.current = sessionId;
      return;
    }
    const id = lastSelected.current;
    if (id) container.current?.querySelector<HTMLElement>(`li[data-session-id="${CSS.escape(id)}"] a`)?.focus();
  }, [sessionId]);
  return (
    <div ref={container}>
      {sessionId ? (
        <SessionPage key={sessionId} sessionId={sessionId} search={search} />
      ) : (
        <Roster search={search} />
      )}
    </div>
  );
}
