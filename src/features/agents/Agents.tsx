import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, FileText, Maximize2, MessageSquare, Minimize2, PanelRight, Plus, X } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  adaptSession,
  adaptSessionDetail,
  type SessionDetailView,
  type SessionView,
} from "../../api/adapters/inspection";
import type { SessionDetail as SessionDetailWire, SessionSummary } from "../../api/wire/proposed";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
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

const OPEN_TABS_KEY = "aq.agents.openSessions";
const MAX_OPEN_TABS = 12;
/** Tabs opened this visit (session storage); the full roster stays in the Sessions listbox. */
function readOpenTabs(): string[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(-MAX_OPEN_TABS) : [];
  } catch { return []; }
}
function writeOpenTabs(ids: string[]) {
  try { sessionStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids.slice(-MAX_OPEN_TABS))); } catch { /* storage unavailable: tabs last for this page only */ }
}

const TAB_STATUS: Record<SessionView["observation"]["state"], string> = {
  reported_running: "Running", reported_stopped: "Stopped", unknown: "State unknown", unsupported: "Unsupported state",
};
function tabStatus(s: SessionView): string {
  return TAB_STATUS[s.observation.state] + (s.observation.freshness === "stale" ? " (stale)" : "");
}

type FocusState = { focusTab?: string } | null;

type SwitcherProps = {
  selected: SessionView; search: string; id: string; hidden: boolean;
  /** Phone: no tab row; the header's ▾ shows the Sessions listbox directly and `onDismiss` hides it again. */
  inline: boolean; onDismiss: (restoreFocus: boolean) => void;
};
function SessionSwitcher({ selected, search, id, hidden, inline, onDismiss }: SwitcherProps) {
  const [scope] = useScope();
  const navigate = useNavigate();
  const location = useLocation();
  const query = usePagedRead<SessionSummary, SessionView>({ resource: "sessions", path: "/api/v1/sessions", scope,
    params: { limit: 25 }, adapt: adaptSession, pollMs: ROSTER_POLL_MS });
  const sessions = query.data?.pages.flatMap(p => p.page.items).slice(0, 100) ?? [];
  const total = query.data?.pages[0]?.page.total ?? null;
  const [openIds, setOpenIds] = useState(() => {
    const ids = readOpenTabs();
    return ids.includes(selected.id) ? ids : [...ids, selected.id].slice(-MAX_OPEN_TABS);
  });
  useEffect(() => writeOpenTabs(openIds), [openIds]);
  const byId = new Map(sessions.map(s => [s.id, s]));
  const tabs = openIds.flatMap(id => id === selected.id ? [selected] : byId.get(id) ?? []);

  const tabLinks = useRef(new Map<string, HTMLAnchorElement>());
  const pendingFocus = useRef<string | null>((location.state as FocusState)?.focusTab ?? null);
  useEffect(() => {
    const id = pendingFocus.current;
    const link = id && tabLinks.current.get(id);
    if (link) { pendingFocus.current = null; link.focus(); }
  });

  const go = (id: string, state?: FocusState) => navigate({ pathname: `/agents/${encodeURIComponent(id)}`, search }, { state });
  function close(id: string) {
    const i = tabs.findIndex(t => t.id === id);
    const neighbour = tabs[i + 1] ?? tabs[i - 1];
    const next = openIds.filter(x => x !== id);
    writeOpenTabs(next);
    setOpenIds(next);
    if (id !== selected.id) pendingFocus.current = neighbour?.id ?? selected.id;
    else if (neighbour) go(neighbour.id, { focusTab: neighbour.id });
    else navigate({ pathname: "/agents", search });
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(0);
  const opener = useRef<HTMLButtonElement | null>(null);
  const listbox = useRef<HTMLUListElement>(null);
  const nav = useRef<HTMLElement>(null);
  const listboxId = useId();
  function openMenu(trigger: HTMLButtonElement) {
    opener.current = trigger;
    setActive(selectedIndex);
    setMenuOpen(true);
  }
  function closeMenu(restoreFocus: boolean) {
    if (inline) { onDismiss(restoreFocus); return; }
    setMenuOpen(false);
    if (restoreFocus) opener.current?.focus();
  }
  const shown = inline ? !hidden : menuOpen;
  const selectedIndex = Math.max(0, sessions.findIndex(s => s.id === selected.id));
  useEffect(() => {
    if (!shown) return;
    if (inline) setActive(selectedIndex);
    listbox.current?.focus();
  }, [shown, inline, selectedIndex]);
  const dismiss = useRef(closeMenu);
  dismiss.current = closeMenu;
  useEffect(() => {
    if (!shown) return;
    // The header's ▾ (aria-controls this nav) toggles it itself.
    const outside = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!nav.current?.contains(target) && !target.closest?.(`[aria-controls="${id}"]`)) dismiss.current(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [shown, id]);
  useEffect(() => {
    if (shown) document.getElementById(`${listboxId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [shown, active, listboxId]);
  function choose(s: SessionView) {
    if (s.id === selected.id) { closeMenu(true); return; }
    closeMenu(false);
    go(s.id);
  }
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = sessions.length - 1;
    const move: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in move) { e.preventDefault(); setActive(move[e.key]!); }
    else if ((e.key === "Enter" || e.key === " ") && sessions[active]) { e.preventDefault(); choose(sessions[active]); }
    else if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
  }
  const toggle = (e: MouseEvent<HTMLButtonElement>) => menuOpen && opener.current === e.currentTarget ? closeMenu(false) : openMenu(e.currentTarget);
  const menuProps = { "aria-haspopup": "listbox" as const, "aria-expanded": menuOpen, "aria-controls": listboxId, onClick: toggle };

  return <nav ref={nav} id={id} hidden={hidden} data-inline={inline || undefined} className={styles.switcher} aria-label="Session switcher"
    onBlur={e => { if (!inline && menuOpen && !nav.current?.contains(e.relatedTarget as Node | null)) setMenuOpen(false); }}>
    {!inline && <><ActionButton {...menuProps} className={styles.sessionsButton}>
      <span className={styles.fullLabel}>Sessions {total && <span className={styles.sessionCount}><CountLabel total={total} /></span>}</span>
      <span className={styles.compactLabel}><span className="visually-hidden">Switch session, current </span>{compactSessionLabel(selected)}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </ActionButton>
    <div className={styles.tabs}>
      {tabs.map(s => {
        const current = s.id === selected.id;
        const statusId = `${listboxId}-tab-${s.id}`;
        return <div key={s.id} className={styles.sessionTab} data-current={current || undefined}>
          <Link ref={el => { if (el) tabLinks.current.set(s.id, el); else tabLinks.current.delete(s.id); }}
            to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }} title={s.label} aria-label={s.label}
            aria-describedby={statusId} aria-current={current ? "page" : undefined} className={styles.tabLink}>
            <span className={styles.sessionDot} data-state={s.observation.state} aria-hidden="true" />
            <span className={styles.tabName}>{compactSessionLabel(s)}</span>
          </Link>
          <span id={statusId} className={styles.tabStatus}>· {tabStatus(s)}</span>
          <button type="button" className={styles.tabClose} aria-label={`Close ${s.label}`} onClick={() => close(s.id)}><X size={16} aria-hidden="true" /></button>
        </div>;
      })}
      <ActionButton {...menuProps} className={styles.addTab} aria-label="Open another session"><Plus size={18} aria-hidden="true" /></ActionButton>
    </div></>}
    <div className={styles.sessionMenu} hidden={!shown}>
      {sessions.length > 0
        ? <ul ref={listbox} id={listboxId} role="listbox" aria-label="Sessions" tabIndex={0} className={styles.sessionOptions}
            aria-activedescendant={shown ? `${listboxId}-${active}` : undefined} onKeyDown={onListKey}>
            {sessions.map((s, i) => <li key={s.id} id={`${listboxId}-${i}`} role="option" aria-selected={s.id === selected.id}
              data-active={i === active || undefined} className={styles.sessionOption} onClick={() => choose(s)} onPointerMove={() => setActive(i)}>
              <span className={styles.sessionDot} data-state={s.observation.state} aria-hidden="true" />
              <span className={styles.optionText}>
                <span>{s.label} <span className={styles.tabStatus}>· {tabStatus(s)}</span></span>
                <span className={styles.meta}>{s.task?.title ?? "No task"} · {s.project.label}</span>
              </span>
            </li>)}
          </ul>
        : <p id={listboxId} className={styles.muted}>{query.isError ? "Sessions unavailable" : query.data ? "No other sessions" : "Loading sessions…"}</p>}
      {query.hasNextPage && sessions.length < 100 && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more sessions</ActionButton>}
    </div>
    {query.isError && <span className={styles.muted}>Session switcher unavailable</span>}
  </nav>;
}

type DrawerKind = "details" | "transcript";

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
  const switcherToggle = useRef<HTMLButtonElement>(null);
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
  const location = useLocation();
  const navigated = location.key !== "default";
  // Closing the current tab hands focus to its neighbouring tab, not the heading.
  const tabFocus = Boolean((location.state as FocusState)?.focusTab);
  const loaded = query.data?.view.id;
  useEffect(() => {
    if (navigated && !tabFocus && loaded === sessionId) heading.current?.focus();
  }, [navigated, tabFocus, loaded, sessionId]);

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
  const taskLink = s.task && taskView.enabled
    ? <Link className={styles.taskLink} aria-label={s.task.title} to={{ pathname: `/work/${encodeURIComponent(s.task.id)}`, search: scopeSearch({ kind: "project", project_id: s.project.id }) }}><span className={styles.fullLabel}>{s.task.title}</span><span className={styles.compactLabel}>{s.task.title === s.task.id ? `Task ${s.task.id.slice(0, 8)}` : s.task.title}</span></Link>
    : <span className={styles.taskLink}>{s.task?.title ?? "No task"}</span>;

  const switcher = <SessionSwitcher selected={s} search={search} id={switcherId} hidden={!switcherOpen} inline={phone}
    onDismiss={restoreFocus => { setSwitcherChoice(false); if (restoreFocus) switcherToggle.current?.focus(); }} />;

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
        <button ref={switcherToggle} type="button" className={styles.iconControl} aria-label="Sessions" aria-expanded={switcherOpen} aria-controls={switcherId} onClick={() => setSwitcherChoice(!switcherOpen)}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        {!phone && taskLink && <><span className={styles.crumbSeparator} aria-hidden="true">·</span>{taskLink}</>}
        <button type="button" className={`${styles.iconControl} ${styles.expand}`} aria-label={expanded ? "Exit expanded workspace" : "Expand workspace"} aria-pressed={expanded} disabled={!canExpand}
          onClick={() => { if (expanded) void document.exitFullscreen?.(); else void workspace.current?.requestFullscreen?.(); }}>
          {expanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
        </button>
        {/* Phone: the listbox drops from the header row as an overlay. */}
        {phone && switcher}
      </div>
      {query.isError && <p className={styles.warning}>Refresh failed. Showing the last successful read.</p>}

      {!phone && switcher}
      <div className={styles.outputWorkspace}>
        <Toolbar className={styles.outputHeading}>
          <strong title={`${s.profile.provider ?? "Provider unknown"} · ${profileText(s.profile)}`}>{s.profile.provider ?? "Provider unknown"} · {profileText(s.profile)}</strong>
          {phone && taskLink}
        </Toolbar>
      {s.terminal && terminal.enabled ? <InteractiveTerminal key={s.terminal.id} terminalId={s.terminal.id} name={s.label} feed={feed} /> : <div className={styles.terminal} role="note">
        <strong>Terminal is not available</strong>
        <span>{terminal.enabled ? "Watching and control are not connected yet." : terminal.reason}</span>
      </div>}

      <footer className={styles.outputFooter}><span>{OBSERVATION_LABEL[s.observation.state]}</span><span className={styles.footerCentral}>Central state: {executionAuthorityText(s.executionAuthority)}</span><span>{s.lastActivityAt ? `Last activity ${formatAge(serverTime, s.lastActivityAt)}` : "Last activity unknown"}</span></footer>
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
