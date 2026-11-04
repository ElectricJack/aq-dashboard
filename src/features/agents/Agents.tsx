import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, FileText, Maximize2, MessageSquare, Minimize2, PanelRight, X } from "lucide-react";
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
import { InteractiveTerminal } from "./InteractiveTerminal";
import { createOutputFeed, TerminalTail } from "./TerminalTail";
import { Icon } from "../../components/icons";
import { SessionUsage } from "./SessionUsage";
import { SessionEvents } from "./SessionEvents";
import { ContractError } from "../../api/adapters/contract";
import { ActionButton, DetailList, Toolbar } from "../../components/layout/Workspace";
import { useMediaQuery } from "../../components/useMediaQuery";

/** Initial budgets from docs/plans/0001 §2. */
const ROSTER_POLL_MS = 10_000;
const DETAIL_POLL_MS = 5_000;

/** Preserve user labels; shorten only the server's UUID fallback for compact chrome. */
function compactSessionLabel(s: SessionView): string {
  const fallback = ["Remote session", "Central session", "Session"].some(prefix => s.label === `${prefix} ${s.id}`);
  return fallback ? s.label.slice(0, -s.id.length) + s.id.slice(0, 8) : s.label;
}

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

function SessionSwitcher({ selected, search, id, hidden }: { selected: SessionView; search: string; id: string; hidden: boolean }) {
  const [scope] = useScope();
  const query = usePagedRead<SessionSummary, SessionView>({ resource: "sessions", path: "/api/v1/sessions", scope,
    params: { limit: 25 }, adapt: adaptSession, pollMs: ROSTER_POLL_MS });
  const sessions = query.data?.pages.flatMap(p => p.page.items).slice(0, 100) ?? [];
  return <nav id={id} hidden={hidden} className={styles.switcher} aria-label="Session switcher">
    {sessions.length === 0 && <span className={styles.sessionTab} aria-label={selected.label} aria-current="page">{compactSessionLabel(selected)}</span>}
    {sessions.map(s => <Link key={s.id} title={s.label} aria-label={s.label} className={styles.sessionTab} aria-current={s.id === selected.id ? "page" : undefined}
      to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }}><span className={styles.sessionDot} aria-hidden="true" />{compactSessionLabel(s)}</Link>)}
    {sessions.length > 0 && !sessions.some(s => s.id === selected.id) && <span className={styles.sessionTab} aria-label={selected.label} aria-current="page">{compactSessionLabel(selected)}</span>}
    {query.hasNextPage && sessions.length < 100 && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>More sessions</ActionButton>}
    {query.isError && <span className={styles.muted}>Session switcher unavailable</span>}
  </nav>;
}

type DrawerKind = "details" | "transcript";
const MESSAGE_UNAVAILABLE = "Messaging unavailable on this AQ server";

/** On-demand drawer: right side over the workspace on desktop, bottom sheet on phone.
 * Modal while open (focus contained, Esc closes); focus returns to the opener. */
function SessionDrawer({ id, title, open, wide, onClose, returnFocus, children }: {
  id: string; title: string; open: boolean; wide?: boolean; onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) { dialog.close(); returnFocus.current?.focus(); }
  }, [open, returnFocus]);
  return <dialog ref={ref} id={id} aria-labelledby={headingId} className={styles.drawer} data-wide={wide || undefined}
    onCancel={e => { e.preventDefault(); onClose(); }}>
    {open && <>
      <div className={styles.drawerHeader}>
        <h2 id={headingId}>{title}</h2>
        <ActionButton onClick={onClose}><Icon icon={X} size={18} />Close</ActionButton>
      </div>
      <div className={styles.drawerBody} tabIndex={0} aria-labelledby={headingId} role="region">{children}</div>
    </>}
  </dialog>;
}

function SessionPage({ sessionId, search }: { sessionId: string; search: string }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const terminal = bootstrap.capability("terminal.watch");
  const taskView = bootstrap.capability("tasks.read");
  const phone = useMediaQuery("(max-width: 767px)");
  // Desktop keeps the session tabs open; the phone header collapses them behind the name's ▾.
  const [switcherChoice, setSwitcherChoice] = useState<boolean | null>(null);
  const switcherOpen = switcherChoice ?? !phone;
  const workspace = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const sync = () => setExpanded(document.fullscreenElement != null && document.fullscreenElement === workspace.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const canExpand = typeof document !== "undefined" && document.fullscreenEnabled === true;
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [feed] = useState(createOutputFeed);
  const messageReason = useId();
  const openDrawer = (kind: DrawerKind, from: HTMLElement) => { opener.current = from; setDrawer(v => v === kind ? null : kind); };
  const toggle = (kind: DrawerKind) => (e: React.MouseEvent<HTMLElement>) => openDrawer(kind, e.currentTarget);
  const closeDrawer = () => setDrawer(null);
  const query = useRead<SessionDetailWire, SessionDetailView>({
    resource: "session",
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
    scope,
    params: {},
    adapt: (wire, time) => {
      if (wire.id !== sessionId) throw new ContractError("Session detail identity changed");
      return adaptSessionDetail(wire, time);
    },
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
      <div className={styles.detail}>
        <Link to={{ pathname: "/agents", search }} className={styles.back}>All sessions</Link>
        <QueryStatus
          status={query.isError ? "error" : "pending"}
          error={query.error}
          label="this session"
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  const { view: s, serverTime } = query.data;
  const headingId = `session-${s.id}-heading`;
  const switcherId = `session-${s.id}-switcher`;
  const live = !!s.terminal && terminal.enabled;
  const facts = <><span>{OBSERVATION_LABEL[s.observation.state]}</span><span className={styles.footerCentral}>Central state: {executionAuthorityText(s.executionAuthority)}</span><span>{s.lastActivityAt ? `Last activity ${formatAge(serverTime, s.lastActivityAt)}` : "Last activity unknown"}</span></>;
  const taskLink = s.task && taskView.enabled
    ? <Link className={styles.taskLink} aria-label={s.task.title} to={{ pathname: `/work/${encodeURIComponent(s.task.id)}`, search: scopeSearch({ kind: "project", project_id: s.project.id }) }}><span className={styles.fullLabel}>{s.task.title}</span><span className={styles.compactLabel}>{s.task.title === s.task.id ? `Task ${s.task.id.slice(0, 8)}` : s.task.title}</span></Link>
    : <span className={styles.taskLink}>{s.task?.title ?? "No task"}</span>;

  return (
    <section ref={workspace} className={styles.detail} aria-labelledby={headingId} data-viewport-fit="">
      <div className={styles.focusHeader}>
        <Link to={{ pathname: "/agents", search }} className={styles.crumb} aria-label="Back to Agents">
          <ChevronLeft className={styles.backIcon} size={20} aria-hidden="true" />Agents
        </Link>
        <span className={styles.crumbSeparator} aria-hidden="true">/</span>
        <h2 id={headingId} aria-label={s.label} ref={heading} tabIndex={-1} className={styles.title}>
          <span className={styles.fullLabel}>{s.label}</span><span className={styles.compactLabel}>{compactSessionLabel(s)}</span>
        </h2>
        <button type="button" className={styles.iconControl} aria-label="Sessions" aria-expanded={switcherOpen} aria-controls={switcherId} onClick={() => setSwitcherChoice(!switcherOpen)}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {!phone && taskLink && <><span className={styles.crumbSeparator} aria-hidden="true">·</span>{taskLink}</>}
        <button type="button" className={`${styles.iconControl} ${styles.expand}`} aria-label={expanded ? "Exit expanded workspace" : "Expand workspace"} aria-pressed={expanded} disabled={!canExpand}
          onClick={() => { if (expanded) void document.exitFullscreen?.(); else void workspace.current?.requestFullscreen?.(); }}>
          {expanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
        </button>
      </div>
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}

      <SessionSwitcher selected={s} search={search} id={switcherId} hidden={!switcherOpen} />
      <div className={styles.outputWorkspace}>
        <Toolbar className={styles.outputHeading}>
          <strong title={`${s.profile.provider ?? "Provider unknown"} · ${profileText(s.profile)}`}>{s.profile.provider ?? "Provider unknown"} · {profileText(s.profile)}</strong>
          {phone && taskLink}
        </Toolbar>
      {live ? <InteractiveTerminal key={s.terminal!.id} terminalId={s.terminal!.id} name={s.label} feed={feed} facts={facts}
        transcriptOpen={drawer === "transcript"} onTranscript={from => openDrawer("transcript", from)} onDetails={from => openDrawer("details", from)} messageReason={MESSAGE_UNAVAILABLE} /> : <div className={styles.terminal} role="note">
        <strong>Terminal is not available</strong>
        <span>{terminal.enabled ? "Watching and control are not connected yet." : terminal.reason}</span>
      </div>}

      {/* With a live terminal these facts join its one-row status footer (AG-D); otherwise they stand alone. */}
      {!live && <footer className={styles.outputFooter}>{facts}</footer>}
      {/* Phone: the terminal's pinned action bar (reference 11) carries Transcript, Message and Details instead. */}
      {!(phone && live) && <Toolbar className={styles.sessionActions} role="group" aria-label="Session actions">
        {/* Durable Message needs a server capability; no composer is shown until one exists. */}
        <span className={styles.messageSlot}>
          <ActionButton disabled aria-describedby={messageReason}><Icon icon={MessageSquare} size={18} />Message</ActionButton>
          <span id={messageReason} className={styles.muted}>{MESSAGE_UNAVAILABLE}</span>
        </span>
        {s.terminal && terminal.enabled && <ActionButton aria-haspopup="dialog" aria-expanded={drawer === "transcript"} aria-controls={`session-${s.id}-transcript`} onClick={toggle("transcript")}><Icon icon={FileText} size={18} />Transcript</ActionButton>}
        <ActionButton aria-label="Session details" aria-haspopup="dialog" aria-expanded={drawer === "details"} aria-controls={`session-${s.id}-details`} onClick={toggle("details")}><Icon icon={PanelRight} size={18} />Details</ActionButton>
      </Toolbar>}
      </div>

      {s.terminal && terminal.enabled && <SessionDrawer id={`session-${s.id}-transcript`} title="Transcript" wide open={drawer === "transcript"} onClose={closeDrawer} returnFocus={opener}>
        <TerminalTail terminalId={s.terminal.id} feed={feed} />
      </SessionDrawer>}
      <SessionDrawer id={`session-${s.id}-details`} title="Session details" open={drawer === "details"} onClose={closeDrawer} returnFocus={opener}>
      {(!query.isError && bootstrap.capability("session.usage.read").enabled && s.observationBinding
        ? <SessionUsage binding={s.observationBinding} />
        : <p className={styles.muted}>Session usage unavailable for this session.</p>)}
      {!query.isError && bootstrap.capability("session.events.read").enabled && s.observationBinding && <SessionEvents key={s.id} binding={s.observationBinding} />}
      <DetailList>
        <dt>Session ID</dt><dd>{s.id}</dd>
        <dt>Recorded session label</dt><dd>{s.label}</dd>
        <dt>Project</dt><dd>{s.project.label}</dd>
        {s.task && <><dt>Task ID</dt><dd>{s.task.id}</dd></>}
        <dt>Last process observation</dt><dd>{OBSERVATION_LABEL[s.observation.state]} · <FreshnessLabel serverTime={serverTime} observedAt={s.observation.observedAt} stale={s.observation.freshness === "stale"} /></dd>
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
      </SessionDrawer>
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
