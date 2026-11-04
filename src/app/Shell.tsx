import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SupervisorWorkspace } from "../features/supervisor/SupervisorWorkspace";
import { SearchDialog } from "../features/search/SearchDialog";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ChevronDown, Ellipsis, LayoutGrid, Menu, Search, X } from "lucide-react";
import { adaptOverview, type OverviewView } from "../api/adapters/inspection";
import type { Overview as OverviewWire } from "../api/wire/overview";
import type { Scope } from "../api/wire/proposed";
import { useMediaQuery } from "../components/useMediaQuery";
import { DESTINATION_ICON, Icon } from "../components/icons";
import { ProviderUsageStrip, ProviderUsageSummary } from "../components/ProviderUsageStrip/ProviderUsageStrip";
import { ScopePicker } from "../components/ScopePicker";
import { TitleFocusContext } from "./DestinationPage";
import { DESTINATIONS, PHONE_PRIMARY, destination, type Destination } from "./destinations";
import { scopeSearch, useScope } from "./scope";
import { useSession } from "./session";
import { BundleNotice } from "./BundleNotice";
import styles from "./Shell.module.css";
import { useProjects } from "./useProjects";
import { useProviderUsage } from "./useProviderUsage";
import { useRead } from "./useRead";

/** Matches the phone breakpoint in Shell.module.css. */
const PHONE_QUERY = "(max-width: 767px)";
const BADGE_POLL_MS = 30_000;

/**
 * Pending count for the Decisions destination, from the scoped overview's
 * needs-you total (shared query with the Overview page). Null when unknown or
 * zero so the shell never shows an invented or empty badge.
 */
type Badge = { text: string; label: string };
function usePendingBadge(scope: Scope, enabled: boolean): Badge | null {
  const read = useRead<OverviewWire, OverviewView>({
    enabled,
    resource: "overview",
    path: "/api/v1/overview",
    scope,
    adapt: adaptOverview,
    pollMs: BADGE_POLL_MS,
  });
  if (!enabled || !read.data || read.isError) return null;
  const total = read.data.view.counts.needs_you;
  if (total.value === null || total.value <= 0) return null;
  const approximate = total.accuracy !== "exact" || read.data.coverage.state !== "complete";
  const shown = total.value > 99 ? "99+" : String(total.value);
  return {
    text: approximate ? `~${shown}` : shown,
    // The name must contain the visible badge text (WCAG 2.5.3): "~3" reads as "3 pending, approximate".
    label: `${shown} pending${approximate ? ", approximate" : ""}`,
  };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? Array.from(w)[0]!.toUpperCase() : "");
  return words.length > 1 ? first(words[0]) + first(words.at(-1)) : first(words[0]);
}

function Avatar({ name }: { name: string }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function DestinationLink({ dest, search, badge, onClick }: { dest: Destination; search: string; badge?: Badge | null; onClick?: () => void }) {
  return (
    <NavLink
      to={{ pathname: `/${dest.id}`, search }}
      onClick={onClick}
      className={styles.navLink}
      aria-label={badge ? `${dest.label}, ${badge.label}` : undefined}
    >
      <Icon icon={DESTINATION_ICON[dest.id]} />
      <span>{dest.label}</span>
      {/* A real space keeps the visible text "Decisions 3" inside the accessible name (WCAG 2.5.3). */}
      {badge && " "}
      {badge && (
        <span className={styles.badge} aria-hidden="true">
          {badge.text}
        </span>
      )}
    </NavLink>
  );
}

const MORE = DESTINATIONS.filter((d) => d.phone === "more");

type SheetControl = { open: boolean; id: string; onOpen: (opener: HTMLElement) => void };

function PhoneNav({ search, sheet }: { search: string; sheet: SheetControl }) {
  const { pathname } = useLocation();
  const moreRoute = MORE.some((d) => pathname === `/${d.id}` || pathname.startsWith(`/${d.id}/`));
  return (
    <nav aria-label="Primary (compact)" className={styles.phoneNav}>
      <ul className={styles.phoneBar}>
        {PHONE_PRIMARY.map((id) => (
          <li key={id}>
            <DestinationLink dest={destination(id)} search={search} />
          </li>
        ))}
        <li>
          <button
            type="button"
            className={styles.navLink}
            data-more
            data-active={sheet.open || moreRoute || undefined}
            aria-haspopup="dialog"
            aria-expanded={sheet.open}
            aria-controls={sheet.open ? sheet.id : undefined}
            onClick={(e) => sheet.onOpen(e.currentTarget)}
          >
            <Icon icon={Ellipsis} />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * Phone bottom sheet for the destinations that do not fit the bar; ☰ and More open it.
 * A native modal dialog supplies the focus trap, Escape and inertness of the page behind.
 * It unmounts on close so the browser's own focus restore never competes with the
 * page-title focus after a destination link navigates.
 */
function MoreSheet({ id, search, badge, onClose }: { id: string; search: string; badge: Badge | null; onClose: (restoreFocus: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The page behind a modal dialog is inert, so close it before focus returns to the opener.
  const dismiss = (restoreFocus: boolean) => {
    if (restoreFocus && dialog.current?.open) dialog.current.close();
    onClose(restoreFocus);
  };
  useLayoutEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      id={id}
      className={styles.sheet}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        dismiss(true);
      }}
      onClose={() => dismiss(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismiss(true);
        } else if (e.key === "Tab") {
          // A modal dialog lets Tab leave for the browser chrome; wrap inside the sheet instead.
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
          const edge = e.shiftKey ? items[0] : items.at(-1);
          if (edge && document.activeElement === edge) {
            e.preventDefault();
            (e.shiftKey ? items.at(-1) : items[0])?.focus();
          }
        }
      }}
      // The dialog has no padding, so a click whose target is the dialog itself landed on the scrim.
      onClick={(e) => e.target === e.currentTarget && dismiss(true)}
    >
      <div className={styles.sheetBody}>
        <div className={styles.sheetHead}>
          <h2 id={titleId}>More</h2>
          <button type="button" className={styles.sheetClose} onClick={() => dismiss(true)}>
            <Icon icon={X} size={18} />
            <span>Close</span>
          </button>
        </div>
        <ul className={styles.moreList} aria-label="More destinations">
          {MORE.map((d) => (
            <li key={d.id}>
              <DestinationLink dest={d} search={search} badge={d.id === "decisions" ? badge : null} onClick={() => dismiss(false)} />
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);
/** Text entry raises the phone keyboard, so the bottom bar steps aside while it has focus. */
function isTextEntry(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Bootstrap keeps polling while AQ is unreachable, so that state is a reconnect attempt. */
const CONNECTION_TEXT = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  signed_out: "Sign-in expired",
} as const;
type ConnectionState = keyof typeof CONNECTION_TEXT;

function ConnectionStatus({ state, className }: { state: ConnectionState; className?: string }) {
  return (
    <span className={className} data-state={state} role="status">
      <span className={styles.connectionText}>{CONNECTION_TEXT[state]}</span>
    </span>
  );
}

export function Shell() {
  const { bootstrap, connection } = useSession();
  const [scope, setScope] = useScope();
  const usage = useProviderUsage();
  const projects = useProjects();
  const canSearch = bootstrap.capability("search.read").enabled;
  const lastTitlePath = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const usageDetails = useRef<HTMLDetailsElement>(null);
  const usageSummary = useRef<HTMLElement>(null);
  const usageId = useId();
  const [quotaCollapsed, setQuotaCollapsed] = useState(false);
  const [entryFocus, setEntryFocus] = useState(false);
  const sheetId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const openSheet = useCallback((opener: HTMLElement) => {
    sheetOpener.current = opener;
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback((restoreFocus: boolean) => {
    setSheetOpen(false);
    if (restoreFocus) sheetOpener.current?.focus();
  }, []);
  const { pathname } = useLocation();
  useEffect(() => setSheetOpen(false), [pathname]);
  const closeUsage = () => {
    if (usageDetails.current) usageDetails.current.open = false;
    usageSummary.current?.focus();
  };
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchButton.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canSearch && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch]);
  const compactUsage = usage.state.status !== "ready" && !(usage.state.status === "configured" && usage.state.data.accounts.length > 0);
  const online = useSyncExternalStore(subscribeOnline, browserOnline, () => true);
  const reachable = connection === "connected" && !usage.unreachable;
  const status: ConnectionState = connection === "signed_out" ? "signed_out" : !online ? "offline" : reachable ? "connected" : "reconnecting";
  const phone = useMediaQuery(PHONE_QUERY);
  const focusedSession = /^\/agents\/[^/]+\/?$/.test(pathname);
  useEffect(() => {
    if (!phone) setSheetOpen(false);
  }, [phone]);
  const badge = usePendingBadge(scope, bootstrap.capability("dashboard.overview").enabled);
  const name = bootstrap.principal.displayName;
  const search = scopeSearch(scope);
  const scopePicker = <ScopePicker className={styles.scope} scope={scope} onChange={setScope} projects={projects.data?.view ?? []} />;
  const isMock = import.meta.env.MODE === "mock";

  return (
    <div
      className={styles.shell}
      data-focused-session={focusedSession || undefined}
      data-compact-usage={compactUsage || undefined}
      data-quota-collapsed={quotaCollapsed || undefined}
      data-entry-focus={(phone && entryFocus) || undefined}
    >
      <a href="#content" className={styles.skip}>
        Skip to content
      </a>
      <aside className={styles.rail} aria-label="Application navigation">
        <p className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            aq
          </span>
          Agent Q
        </p>
        <nav aria-label="Primary" className={styles.railNav}>
          {!phone && (
            <div className={styles.railScope}>
              <Icon icon={LayoutGrid} size={18} className={styles.railScopeIcon} />
              {scopePicker}
              <Icon icon={ChevronDown} size={16} className={styles.railScopeChevron} />
            </div>
          )}
          <ul>
            {DESTINATIONS.filter((d) => d.id !== "settings").map((d) => (
              <li key={d.id}>
                <DestinationLink dest={d} search={search} badge={d.id === "decisions" ? badge : null} />
              </li>
            ))}
          </ul>
          <ul className={styles.railFooter}>
            <li>
              <DestinationLink dest={destination("settings")} search={search} />
            </li>
          </ul>
        </nav>
        <div className={styles.railStatus}>
          {!phone && <ConnectionStatus state={status} className={styles.connection} />}
          <div className={styles.identity}>
            <Avatar name={name} />
            <span>{name}</span>
          </div>
        </div>
      </aside>
      <header className={styles.top}>
        {phone && (
          <button
            type="button"
            className={styles.menuButton}
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-controls={sheetOpen ? sheetId : undefined}
            onClick={(e) => openSheet(e.currentTarget)}
          >
            <Icon icon={Menu} size={22} />
          </button>
        )}
        {isMock && (
          <p className={styles.mockBanner} role="note" title="Mock data · proposed contracts, not a live AQ server">
            Mock<span className={styles.mockWord}> data</span>
            <span className="visually-hidden"> · proposed contracts, not a live AQ server</span>
          </p>
        )}
        <div className={styles.scopeRow}>
          <p className={styles.phoneBrand} aria-hidden="true">
            <span className={styles.mark}>aq</span>
            Agent Q
          </p>
          {phone && scopePicker}
        </div>
        <button
          ref={searchButton}
          type="button"
          className={styles.search}
          disabled={!canSearch}
          title={canSearch ? undefined : "Search is not available on this AQ server"}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => setSearchOpen(true)}
        >
          <Icon icon={Search} size={18} />
          <span>Search</span>
          <kbd className={styles.kbd} aria-hidden="true">
            Ctrl K
          </kbd>
        </button>
        {phone && <ConnectionStatus state={status} className={styles.connection} />}
        <details id={usageId} ref={usageDetails} className={styles.compactUsage} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); closeUsage(); }
        }}>
          <summary ref={usageSummary}><span className="visually-hidden">Provider usage (account-wide) </span><ProviderUsageSummary state={usage.state} /><Icon icon={ChevronDown} size={16} className={styles.usageChevron} /></summary>
          <div className={styles.usageReason}>
            <ProviderUsageStrip state={usage.state} />
            <button type="button" className={styles.button} onClick={closeUsage}>Close usage details</button>
          </div>
        </details>
        {phone && (
          <button
            type="button"
            className={styles.quotaToggle}
            aria-label="Provider usage row"
            aria-expanded={!quotaCollapsed}
            aria-controls={usageId}
            onClick={() => setQuotaCollapsed((v) => !v)}
          >
            <Icon icon={ChevronDown} size={18} />
          </button>
        )}
        <Link
          to={{ pathname: "/settings", search }}
          className={styles.avatarLink}
        >
          <Avatar name={name} />
          <span className={styles.srOnly}>Settings, signed in as {name}</span>
        </Link>
      </header>
      <main
        id="content"
        className={styles.main}
        onFocus={(e) => setEntryFocus(isTextEntry(e.target))}
        onBlur={() => setEntryFocus(false)}
      >
        <BundleNotice />
        <TitleFocusContext value={lastTitlePath}>
          <SupervisorWorkspace><Outlet /></SupervisorWorkspace>
        </TitleFocusContext>
      </main>
      <PhoneNav search={search} sheet={{ open: sheetOpen, id: sheetId, onOpen: openSheet }} />
      {sheetOpen && <MoreSheet id={sheetId} search={search} badge={badge} onClose={closeSheet} />}
      {searchOpen && canSearch && <SearchDialog onClose={closeSearch} />}
    </div>
  );
}
