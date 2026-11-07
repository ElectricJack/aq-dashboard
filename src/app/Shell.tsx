import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SupervisorWorkspace } from "../features/supervisor/SupervisorWorkspace";
import { SearchDialog } from "../features/search/SearchDialog";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { ChevronDown, Ellipsis, LayoutGrid, Search } from "lucide-react";
import { adaptOverview, type OverviewView } from "../api/adapters/inspection";
import { decisionTotal } from "../api/adapters/overview";
import type { Overview as OverviewWire } from "../api/wire/overview";
import type { Scope } from "../api/wire/proposed";
import { useMediaQuery } from "../components/useMediaQuery";
import { useOnline } from "../components/useOnline";
import { DESTINATION_ICON, Icon } from "../components/icons";
import { ProviderUsageStrip, ProviderUsageSummary } from "../components/ProviderUsageStrip/ProviderUsageStrip";
import { ScopePicker } from "../components/ScopePicker";
import { TitleFocusContext } from "./DestinationPage";
import { DocumentTitleProvider } from "./documentTitle";
import { useBackFocusRestore } from "./focusReturn";
import { DESTINATIONS, PHONE_PRIMARY, destination, type Destination } from "./destinations";
import { scopeSearch, useScope } from "./scope";
import { isFocusedSessionPath } from "./focusedSession";
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
 * review and question source totals (shared query with the Overview page), not
 * `needs_you`, which also counts offline workers and failed results (RR-02).
 * Null when unknown or zero so the shell never shows an invented or empty badge.
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
  const total = decisionTotal(read.data.view.sources);
  if (!total || total.value === null || total.value <= 0) return null;
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


function DestinationLink({ dest, search, badge }: { dest: Destination; search: string; badge?: Badge | null }) {
  return (
    <NavLink
      to={{ pathname: `/${dest.id}`, search }}
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

function PhoneNav({ search, badge }: { search: string; badge: Badge | null }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const moreButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  // SO-21: a tap outside the bar and its sheet closes the sheet.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node) || !nav.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const more = DESTINATIONS.filter((d) => d.phone === "more");
  // SO-21: More carries the active cue while one of its destinations is open.
  const inMore = more.some((d) => location.pathname === `/${d.id}` || location.pathname.startsWith(`/${d.id}/`));

  return (
    <nav
      ref={nav}
      aria-label="Primary (compact)"
      className={styles.phoneNav}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          moreButton.current?.focus();
        }
      }}
    >
      <ul className={styles.phoneBar}>
        {PHONE_PRIMARY.map((id) => (
          <li key={id}>
            <DestinationLink dest={destination(id)} search={search} />
          </li>
        ))}
        <li>
          <button
            ref={moreButton}
            type="button"
            className={styles.navLink}
            data-active={inMore || undefined}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon icon={Ellipsis} />
            <span>More</span>
            {inMore && <span className="visually-hidden">, current section</span>}
          </button>
        </li>
      </ul>
      {/* After the bar in DOM so Tab from More enters the list; CSS places it above. */}
      {open && (
        <ul id={listId} className={styles.moreList} aria-label="More destinations">
          {more.map((d) => (
            <li key={d.id}>
              <DestinationLink dest={d} search={search} badge={d.id === "decisions" ? badge : null} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
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
      {CONNECTION_TEXT[state]}
    </span>
  );
}

export function Shell() {
  const { bootstrap, connection } = useSession();
  const focusedSession = isFocusedSessionPath(useLocation().pathname);
  const [scope, setScope] = useScope();
  const usage = useProviderUsage();
  const projects = useProjects();
  const canSearch = bootstrap.capability("search.read").enabled;
  const lastTitlePath = useRef<string | null>(null);
  const content = useRef<HTMLElement>(null);
  useBackFocusRestore(useCallback(() => content.current, []));
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const usageDetails = useRef<HTMLDetailsElement>(null);
  const usageSummary = useRef<HTMLElement>(null);
  const closeUsage = () => {
    if (usageDetails.current) usageDetails.current.open = false;
    usageSummary.current?.focus();
  };
  // SO-12: the usage popover closes on an outside click, like the other overlays.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const details = usageDetails.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
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
  const online = useOnline();
  const reachable = connection === "connected" && !usage.unreachable;
  const status: ConnectionState = connection === "signed_out" ? "signed_out" : !online ? "offline" : reachable ? "connected" : "reconnecting";
  const phone = useMediaQuery(PHONE_QUERY);
  const badge = usePendingBadge(scope, bootstrap.capability("dashboard.overview").enabled);
  const name = bootstrap.principal.displayName;
  const search = scopeSearch(scope);
  const scopePicker = <ScopePicker className={styles.scope} scope={scope} onChange={setScope} projects={projects.data?.view ?? []} projectsLoaded={!!projects.data} />;
  const isMock = import.meta.env.MODE === "mock";

  return (
    <div className={styles.shell} data-focused-session={focusedSession || undefined} data-compact-usage={compactUsage || undefined}>
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
        {isMock && (
          <p className={styles.mockBanner} role="note" title="Mock data · proposed contracts, not a live AQ server">
            Mock data<span className="visually-hidden"> · proposed contracts, not a live AQ server</span>
          </p>
        )}
        <div className={styles.scopeRow}>
          <p className={styles.phoneBrand} aria-hidden="true">
            <span className={styles.mark}>aq</span>
            <span className={styles.phoneWordmark}>Agent Q</span>
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
        <details ref={usageDetails} className={styles.compactUsage} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); closeUsage(); }
        }}>
          <summary ref={usageSummary}><span className="visually-hidden">Provider usage (account-wide) </span><ProviderUsageSummary state={usage.state} /><Icon icon={ChevronDown} size={16} className={styles.usageChevron} /></summary>
          <div className={styles.usageReason}>
            <ProviderUsageStrip state={usage.state} />
            <button type="button" className={styles.button} onClick={closeUsage}>Close usage details</button>
          </div>
        </details>
        {phone && <ConnectionStatus state={status} className={styles.connection} />}
        <Link
          to={{ pathname: "/settings", search }}
          className={styles.avatarLink}
        >
          <Avatar name={name} />
          <span className={styles.srOnly}>Settings, signed in as {name}</span>
        </Link>
      </header>
      <main id="content" ref={content} className={styles.main}>
        <BundleNotice />
        <TitleFocusContext value={lastTitlePath}>
          <DocumentTitleProvider>
            <SupervisorWorkspace><Outlet /></SupervisorWorkspace>
          </DocumentTitleProvider>
        </TitleFocusContext>
      </main>
      <PhoneNav search={search} badge={badge} />
      {searchOpen && canSearch && <SearchDialog onClose={closeSearch} />}
    </div>
  );
}
