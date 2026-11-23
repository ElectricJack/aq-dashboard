import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";
import { type SessionView } from "../../api/adapters/inspection";
import { CountLabel } from "../../components/QueryStatus/CountLabel";
import styles from "./Agents.module.css";
import { ActionButton } from "../../components/layout/Workspace";
import { useSessionRoster, compactSessionLabel } from "./SessionRoster";

const OPEN_TABS_KEY = "aq.agents.openSessions";
const MAX_OPEN_TABS = 12;
/** Tabs opened this visit (session storage); the full roster stays in the Sessions listbox. */
function readOpenTabs(): string[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string").slice(-MAX_OPEN_TABS)
      : [];
  } catch {
    return [];
  }
}
function writeOpenTabs(ids: string[]) {
  try {
    sessionStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids.slice(-MAX_OPEN_TABS)));
  } catch {
    /* storage unavailable: tabs last for this page only */
  }
}

const TAB_STATUS: Record<SessionView["observation"]["state"], string> = {
  working: "Working",
  quiet: "No progress lately",
  stale: "No recent activity",
  awaiting: "Starting",
  unknown: "Not observed",
  ended: "Ended",
  reported_running: "Running",
  reported_stopped: "Stopped",
  unsupported: "Unsupported state",
};
function tabStatus(s: SessionView): string {
  return (
    TAB_STATUS[s.observation.state] +
    (s.observation.state !== "unknown" &&
    s.observation.state !== "stale" &&
    s.observation.freshness === "stale"
      ? " (stale)"
      : "")
  );
}

export type FocusState = { focusTab?: string } | null;

type SwitcherProps = {
  selected: SessionView;
  search: string;
  id: string;
  hidden: boolean;
  /** Phone: no tab row; the header's ▾ shows the Sessions listbox directly and `onDismiss` hides it again. */
  inline: boolean;
  onDismiss: (restoreFocus: boolean) => void;
};
function useOpenSessionTabs(selected: SessionView, search: string, sessions: SessionView[]) {
  const navigate = useNavigate();
  const location = useLocation();
  const [openIds, setOpenIds] = useState(() => {
    const ids = readOpenTabs();
    return ids.includes(selected.id) ? ids : [...ids, selected.id].slice(-MAX_OPEN_TABS);
  });
  useEffect(() => writeOpenTabs(openIds), [openIds]);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const tabs = openIds.flatMap((id) => (id === selected.id ? [selected] : (byId.get(id) ?? [])));

  const tabLinks = useRef(new Map<string, HTMLAnchorElement>());
  const pendingFocus = useRef<string | null>((location.state as FocusState)?.focusTab ?? null);
  useEffect(() => {
    const id = pendingFocus.current;
    const link = id && tabLinks.current.get(id);
    if (link) {
      pendingFocus.current = null;
      link.focus();
    }
  });

  const go = (id: string, state?: FocusState) =>
    navigate({ pathname: `/agents/${encodeURIComponent(id)}`, search }, { state });
  function close(id: string) {
    const i = tabs.findIndex((t) => t.id === id);
    const neighbour = tabs[i + 1] ?? tabs[i - 1];
    const next = openIds.filter((x) => x !== id);
    writeOpenTabs(next);
    setOpenIds(next);
    if (id !== selected.id) pendingFocus.current = neighbour?.id ?? selected.id;
    else if (neighbour) go(neighbour.id, { focusTab: neighbour.id });
    else navigate({ pathname: "/agents/history", search });
  }

  return { tabs, tabLinks, go, close };
}
export function SessionSwitcher({ selected, search, id, hidden, inline, onDismiss }: SwitcherProps) {
  const { query, sessions } = useSessionRoster();
  const total = query.data?.pages[0]?.page.total ?? null;
  const { tabs, tabLinks, go, close } = useOpenSessionTabs(selected, search, sessions);
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
    if (inline) {
      onDismiss(restoreFocus);
      return;
    }
    setMenuOpen(false);
    if (restoreFocus) opener.current?.focus();
  }
  const shown = inline ? !hidden : menuOpen;
  const selectedIndex = Math.max(
    0,
    sessions.findIndex((s) => s.id === selected.id),
  );
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
      if (!nav.current?.contains(target) && !target.closest?.(`[aria-controls="${id}"]`))
        dismiss.current(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [shown, id]);
  useEffect(() => {
    if (shown) document.getElementById(`${listboxId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [shown, active, listboxId]);
  function choose(s: SessionView) {
    if (s.id === selected.id) {
      closeMenu(true);
      return;
    }
    closeMenu(false);
    go(s.id);
  }
  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const last = sessions.length - 1;
    const move: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
    };
    if (e.key in move) {
      e.preventDefault();
      setActive(move[e.key]!);
    } else if (["Enter", " "].includes(e.key) && sessions[active]) {
      e.preventDefault();
      choose(sessions[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    }
  }
  const toggle = (e: MouseEvent<HTMLButtonElement>) =>
    menuOpen && opener.current === e.currentTarget ? closeMenu(false) : openMenu(e.currentTarget);
  const menuProps = {
    "aria-haspopup": "listbox" as const,
    "aria-expanded": menuOpen,
    "aria-controls": listboxId,
    onClick: toggle,
  };

  return (
    <nav
      ref={nav}
      id={id}
      hidden={hidden}
      data-inline={inline || undefined}
      className={styles.switcher}
      aria-label="Session switcher"
      onBlur={(e) => {
        if (!inline && menuOpen && !nav.current?.contains(e.relatedTarget as Node | null)) setMenuOpen(false);
      }}
    >
      {!inline && (
        <>
          <ActionButton {...menuProps} className={styles.sessionsButton}>
            <span className={styles.fullLabel}>
              Sessions{" "}
              {total && (
                <span className={styles.sessionCount}>
                  <CountLabel total={total} />
                </span>
              )}
            </span>
            <span className={styles.compactLabel}>
              <span className="visually-hidden">Switch session, current </span>
              {compactSessionLabel(selected)}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </ActionButton>
          <div className={styles.tabs}>
            {tabs.map((s) => {
              const current = s.id === selected.id;
              const statusId = `${listboxId}-tab-${s.id}`;
              return (
                <div key={s.id} className={styles.sessionTab} data-current={current || undefined}>
                  <Link
                    ref={(el) => {
                      if (el) tabLinks.current.set(s.id, el);
                      else tabLinks.current.delete(s.id);
                    }}
                    to={{ pathname: `/agents/${encodeURIComponent(s.id)}`, search }}
                    title={
                      s.task?.title && s.task.title !== s.task.id ? `${s.label} · ${s.task.title}` : s.label
                    }
                    aria-label={s.label}
                    aria-describedby={statusId}
                    aria-current={current ? "page" : undefined}
                    className={styles.tabLink}
                  >
                    <span className={styles.sessionDot} data-state={s.observation.state} aria-hidden="true" />
                    <span className={styles.tabName}>{compactSessionLabel(s)}</span>
                  </Link>
                  <span id={statusId} className={styles.tabStatus}>
                    · {tabStatus(s)}
                  </span>
                  <button
                    type="button"
                    className={styles.tabClose}
                    aria-label={`Close ${s.label}`}
                    onClick={() => close(s.id)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
          {/* Outside the scrolling tab row, so it never scrolls out of reach (RA-13). */}
          <ActionButton {...menuProps} className={styles.addTab} aria-label="Open another session">
            <Plus size={18} aria-hidden="true" />
          </ActionButton>
        </>
      )}
      <div className={styles.sessionMenu} hidden={!shown}>
        {sessions.length > 0 ? (
          <ul
            ref={listbox}
            id={listboxId}
            role="listbox"
            aria-label="Sessions"
            tabIndex={0}
            className={styles.sessionOptions}
            aria-activedescendant={shown ? `${listboxId}-${active}` : undefined}
            onKeyDown={onListKey}
          >
            {sessions.map((s, i) => (
              <li
                key={s.id}
                id={`${listboxId}-${i}`}
                role="option"
                aria-selected={s.id === selected.id}
                data-active={i === active || undefined}
                className={styles.sessionOption}
                onClick={() => choose(s)}
                onPointerMove={() => setActive(i)}
              >
                <span className={styles.sessionDot} data-state={s.observation.state} aria-hidden="true" />
                <span className={styles.optionText}>
                  <span>
                    {s.label} <span className={styles.tabStatus}>· {tabStatus(s)}</span>
                  </span>
                  <span className={styles.meta}>
                    {s.task?.title ?? "No task"} · {s.project.label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p id={listboxId} className={styles.muted}>
            {query.isError ? "Sessions unavailable" : query.data ? "No other sessions" : "Loading sessions…"}
          </p>
        )}
        {query.hasNextPage && sessions.length < 100 && (
          <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Load more sessions
          </ActionButton>
        )}
      </div>
      {query.isError && <span className={styles.muted}>Session switcher unavailable</span>}
    </nav>
  );
}
