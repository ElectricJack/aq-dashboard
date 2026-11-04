import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Columns2, Expand, FileText, MessageSquare, Monitor, PanelRight, X } from "lucide-react";
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
import { columnsForPane, InteractiveTerminal, MIN_PANE_COLUMNS } from "./InteractiveTerminal";
import { createOutputFeed, TerminalTail } from "./TerminalTail";
import { Icon } from "../../components/icons";
import { SessionUsage } from "./SessionUsage";
import { SessionEvents } from "./SessionEvents";
import { ContractError } from "../../api/adapters/contract";
import { ActionButton, DetailList, Toolbar } from "../../components/layout/Workspace";

function providerText(s: SessionView) {
  return `${s.profile.provider ?? "Provider unknown"} · ${profileText(s.profile)}`;
}

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

/** The switcher's roster read; the split view's second pane picks from the same cached pages. */
function useSessionRoster() {
  const [scope] = useScope();
  const query = usePagedRead<SessionSummary, SessionView>({ resource: "sessions", path: "/api/v1/sessions", scope,
    params: { limit: 25 }, adapt: adaptSession, pollMs: ROSTER_POLL_MS });
  return { query, sessions: query.data?.pages.flatMap(p => p.page.items).slice(0, 100) ?? [] };
}

function SessionSwitcher({ selected, search }: { selected: SessionView; search: string }) {
  const { query, sessions } = useSessionRoster();
  return <nav className={styles.switcher} aria-label="Session switcher">
    {sessions.length === 0 && <span className={styles.sessionTab} aria-label={selected.label} aria-current="page">{compactSessionLabel(selected)}</span>}
    {sessions.map(s => <Link key={s.id} title={s.label} aria-label={s.label} className={styles.sessionTab} aria-current={s.id === selected.id ? "page" : undefined}
      to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }}><span className={styles.sessionDot} aria-hidden="true" />{compactSessionLabel(s)}</Link>)}
    {sessions.length > 0 && !sessions.some(s => s.id === selected.id) && <span className={styles.sessionTab} aria-label={selected.label} aria-current="page">{compactSessionLabel(selected)}</span>}
    {query.hasNextPage && sessions.length < 100 && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>More sessions</ActionButton>}
    {query.isError && <span className={styles.muted}>Session switcher unavailable</span>}
  </nav>;
}

type DrawerKind = "details" | "transcript";

/** Workspace view (spec §6). Split is explicit and at most two panes; Expand hides page chrome. */
export type WorkspaceView = { layout: "focus" | "split"; expanded: boolean; secondId: string | null };
type ViewChange = (change: Partial<WorkspaceView>) => void;
/** Divider between split panes (`.panes[data-split]` gap). */
const SPLIT_GAP_PX = 1;

/** Per-pane columns a split of the measured workspace would give; null until measured. */
function useSplitColumns(present: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!present || !el) return;
    const observer = new ResizeObserver(() => setColumns(columnsForPane((el.getBoundingClientRect().width - SPLIT_GAP_PX) / 2)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [present]);
  return [ref, columns] as const;
}

function ViewControl({ split, expanded, splitReason, onChange, expandId }: {
  split: boolean; expanded: boolean; splitReason: string | null; onChange: ViewChange; expandId: string;
}) {
  const reasonId = useId();
  return <div className={styles.viewControl}>
    <div role="group" aria-label="Workspace view" className={styles.viewButtons}>
      <ActionButton aria-pressed={!split} onClick={() => onChange({ layout: "focus" })}><Icon icon={Monitor} size={18} /><span className={styles.viewText}>Focus</span></ActionButton>
      <ActionButton aria-pressed={split} disabled={splitReason !== null} aria-describedby={splitReason ? reasonId : undefined}
        onClick={() => onChange({ layout: "split" })}><Icon icon={Columns2} size={18} /><span className={styles.viewText}>Split view</span></ActionButton>
      <ActionButton id={expandId} aria-pressed={expanded} onClick={() => onChange({ expanded: !expanded })}><Icon icon={Expand} size={18} /><span className={styles.viewText}>Expand</span></ActionButton>
    </div>
    {splitReason && <span id={reasonId} className={styles.splitReason}>{splitReason}</span>}
  </div>;
}

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

function SessionPage({ sessionId, search, view, onViewChange }: { sessionId: string; search: string; view: WorkspaceView; onViewChange: ViewChange }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const terminal = bootstrap.capability("terminal.watch");
  const taskView = bootstrap.capability("tasks.read");
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [feed] = useState(createOutputFeed);
  const messageReason = useId();
  const toggle = (kind: DrawerKind) => (e: React.MouseEvent<HTMLElement>) => { opener.current = e.currentTarget; setDrawer(v => v === kind ? null : kind); };
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

  const { sessions: roster } = useSessionRoster();
  const watchable = !!query.data?.view.terminal && terminal.enabled;
  const [panes, paneColumns] = useSplitColumns(watchable);
  const others = roster.filter(o => o.id !== sessionId && o.terminal);
  const second = others.find(o => o.id === view.secondId) ?? others[0] ?? null;
  const splitReason = !watchable ? "Terminal not available"
    : !second ? "No second session with a terminal"
    : paneColumns === null || paneColumns < MIN_PANE_COLUMNS
      ? `Needs at least ${2 * MIN_PANE_COLUMNS} columns${paneColumns === null ? "" : ` (${2 * paneColumns} fit)`}` : null;
  // The chosen layout is kept; it applies only while both panes fit (never shrink the font).
  const split = view.layout === "split" && splitReason === null && second !== null;
  const expanded = view.expanded && !!query.data;
  const page = useRef<HTMLElement>(null);
  const expandId = useId(), exitId = useId();
  useEffect(() => {
    if (!expanded) return;
    const exit = () => { document.getElementById(expandId)?.focus(); onViewChange({ expanded: false }); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      // Dialogs own their Esc; a controlled terminal receives Esc as input (Ctrl+M leaves it).
      if (target?.closest("dialog") || target?.closest("[data-controlling] .xterm")) return;
      e.preventDefault();
      exit();
    };
    // The overlay covers the shell; keep focus from landing on obscured controls behind it.
    const onFocus = (e: FocusEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && page.current && !page.current.contains(target) && !target.closest("dialog")) document.getElementById(exitId)?.focus();
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [expanded, onViewChange, expandId, exitId]);
  const changeView = (change: Partial<WorkspaceView>) => {
    if (change.expanded === false) document.getElementById(expandId)?.focus();
    onViewChange(change);
  };

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

  return (
    <section ref={page} className={styles.detail} aria-labelledby={headingId} data-expanded={expanded || undefined}>
      <Toolbar className={styles.workspaceHeading}>
        <Link to={{ pathname: "/agents", search }} className={styles.back}>All sessions</Link>
        {expanded && <strong className={styles.expandedLabel}>{compactSessionLabel(s)}</strong>}
        <ViewControl split={split} expanded={expanded} splitReason={splitReason} onChange={changeView} expandId={expandId} />
        {expanded && <ActionButton id={exitId} className={styles.exit} aria-keyshortcuts="Escape" onClick={() => changeView({ expanded: false })}>
          <Icon icon={X} size={18} />Exit<span className={styles.exitLong}> expanded view</span><kbd className={styles.kbd} aria-hidden="true">Esc</kbd></ActionButton>}
      </Toolbar>
      <h2 id={headingId} aria-label={s.label} ref={heading} tabIndex={-1} className={styles.title}>
        <span className={styles.fullLabel}>{s.label}</span><span className={styles.compactLabel}>{compactSessionLabel(s)}</span>
      </h2>
      <p className={styles.meta}>
        {s.task && taskView.enabled ? (
          <Link aria-label={s.task.title} to={{ pathname: `/work/${encodeURIComponent(s.task.id)}`, search: scopeSearch({ kind: "project", project_id: s.project.id }) }}><span className={styles.fullLabel}>{s.task.title}</span><span className={styles.compactLabel}>{s.task.title === s.task.id ? `Task ${s.task.id.slice(0, 8)}` : s.task.title}</span></Link>
        ) : (
          s.task?.title ?? "No task"
        )}{" "}
        · {s.project.label}<span className={styles.observationSummary}> · {OBSERVATION_LABEL[s.observation.state]} · <FreshnessLabel serverTime={serverTime} observedAt={s.observation.observedAt} stale={s.observation.freshness === "stale"} /></span>
      </p>
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}

      <SessionSwitcher selected={s} search={search} />
      <div className={styles.outputWorkspace}>
        {!split && <Toolbar className={styles.outputHeading}><strong>{providerText(s)}</strong></Toolbar>}
      <div ref={panes} className={styles.panes} data-split={split || undefined}>
        <div className={styles.paneSlot}>
          {split && <div className={styles.paneCaption}><strong>{s.label}</strong><span>{providerText(s)}</span></div>}
          {s.terminal && terminal.enabled ? <InteractiveTerminal key={s.terminal.id} terminalId={s.terminal.id} name={s.label} feed={feed} fill={expanded}
            label={split ? `Interactive agent terminal, ${s.label}` : undefined} /> : <div className={styles.terminal} role="note">
            <strong>Terminal is not available</strong>
            <span>{terminal.enabled ? "Watching and control are not connected yet." : terminal.reason}</span>
          </div>}
        </div>
        {split && second?.terminal && <div className={styles.paneSlot}>
          <div className={styles.paneCaption}>
            <label>Second pane <select value={second.id} onChange={e => onViewChange({ secondId: e.target.value })}>
              {others.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select></label>
            <span>{providerText(second)}</span>
          </div>
          <InteractiveTerminal key={second.terminal.id} terminalId={second.terminal.id} name={second.label} fill={expanded}
            label={`Interactive agent terminal, ${second.label}`} />
        </div>}
      </div>

      <footer className={styles.outputFooter}><span>{OBSERVATION_LABEL[s.observation.state]}</span><span>Central state: {executionAuthorityText(s.executionAuthority)}</span><span>{s.lastActivityAt ? `Last activity ${formatAge(serverTime, s.lastActivityAt)}` : "Last activity unknown"}</span></footer>
      <Toolbar className={styles.sessionActions} role="group" aria-label="Session actions">
        {/* Durable Message needs a server capability; no composer is shown until one exists. */}
        <span className={styles.messageSlot}>
          <ActionButton disabled aria-describedby={messageReason}><Icon icon={MessageSquare} size={18} />Message</ActionButton>
          <span id={messageReason} className={styles.muted}>Messaging unavailable on this AQ server</span>
        </span>
        {s.terminal && terminal.enabled && <ActionButton aria-haspopup="dialog" aria-expanded={drawer === "transcript"} aria-controls={`session-${s.id}-transcript`} onClick={toggle("transcript")}><Icon icon={FileText} size={18} />Transcript</ActionButton>}
        <ActionButton aria-label="Session details" aria-haspopup="dialog" aria-expanded={drawer === "details"} aria-controls={`session-${s.id}-details`} onClick={toggle("details")}><Icon icon={PanelRight} size={18} />Details</ActionButton>
      </Toolbar>
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
  // View state outlives the per-session page so switching sessions keeps the layout.
  const [view, setView] = useState<WorkspaceView>({ layout: "focus", expanded: false, secondId: null });
  const changeView = useCallback<ViewChange>(change => setView(v => ({ ...v, ...change })), []);
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
        <SessionPage key={sessionId} sessionId={sessionId} search={search} view={view} onViewChange={changeView} />
      ) : (
        <Roster search={search} />
      )}
    </div>
  );
}
