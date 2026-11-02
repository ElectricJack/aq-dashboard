import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchDialog } from "../features/search/SearchDialog";
import { NavLink, Outlet, useLocation } from "react-router";
import { Ellipsis, Search } from "lucide-react";
import { DESTINATION_ICON, Icon } from "../components/icons";
import { ProviderUsageStrip, formatPercent, type ProviderUsageState } from "../components/ProviderUsageStrip/ProviderUsageStrip";
import { ScopePicker } from "../components/ScopePicker";
import { TitleFocusContext } from "./DestinationPage";
import { DESTINATIONS, PHONE_PRIMARY, destination, type Destination } from "./destinations";
import { scopeSearch, useScope } from "./scope";
import { useSession } from "./session";
import styles from "./Shell.module.css";
import { useProjects } from "./useProjects";
import { useProviderUsage } from "./useProviderUsage";
import { configuredAccountLabel, configuredAccountStatus, configuredProviderLabel } from "../api/adapters/configuredProviders";

function DestinationLink({ dest, search }: { dest: Destination; search: string }) {
  return (
    <NavLink to={{ pathname: `/${dest.id}`, search }} className={styles.navLink}>
      <Icon icon={DESTINATION_ICON[dest.id]} />
      <span>{dest.label}</span>
    </NavLink>
  );
}

function PhoneNav({ search }: { search: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const moreButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const more = DESTINATIONS.filter((d) => d.phone === "more");

  return (
    <nav
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
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon icon={Ellipsis} />
            <span>More</span>
          </button>
        </li>
      </ul>
      {/* After the bar in DOM so Tab from More enters the list; CSS places it above. */}
      {open && (
        <ul id={listId} className={styles.moreList} aria-label="More destinations">
          {more.map((d) => (
            <li key={d.id}>
              <DestinationLink dest={d} search={search} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

const CONNECTION_TEXT = {
  connected: "Connected",
  unreachable: "Disconnected",
  signed_out: "Sign-in expired",
} as const;

/** Compact presentation only; the full account/window facts remain in the disclosure. */
function UsageSummary({ state }: { state: ProviderUsageState }) {
  if (state.status === "configured") {
    if (state.data.accounts.length === 0) return <>No providers configured</>;
    return <span className={styles.usageAccounts}>{state.data.accounts.slice(0, 2).map(account => <span className={styles.usageAccount} key={JSON.stringify([account.provider, account.account_reference])} title={`${configuredAccountLabel(account)}: ${configuredAccountStatus(account)}; quota unavailable; startup configuration only`}>
      <span>{configuredProviderLabel(account)}</span><span data-stale={state.stale || undefined}>{configuredAccountStatus(account)} · quota unavailable</span>
    </span>)}{state.data.accounts.length > 2 && <span>+{state.data.accounts.length - 2}</span>}</span>;
  }
  if (state.status === "configuration-error") return <>Provider configuration unavailable</>;
  if (state.status !== "ready") return <>{state.status === "loading" ? "Loading usage…" : "Usage unavailable"}</>;
  if (state.data.providers.length === 0) return <>No provider accounts reported</>;
  return <span className={styles.usageAccounts}>{state.data.providers.map(provider => {
    const primary = provider.windows.find(window => window.id === provider.preferredWindowId) ?? provider.windows[0];
    const amount = primary?.state === "known" && primary.usedPercent !== null ? `${formatPercent(primary.usedPercent)} used` : primary?.state === "unsupported" ? "Unsupported usage state" : "Usage unavailable";
    const qualifiers = [primary?.quality === "estimated" && "estimated", primary?.coverage === "partial" && "partial", primary?.freshness === "stale" && "stale"].filter(Boolean);
    const text = [amount, ...qualifiers].join(" · ");
    return <span key={`${provider.providerId}:${provider.accountRef}`} className={styles.usageAccount} title={`${provider.accountLabel}: ${text}`}>
      <span>{provider.accountLabel}</span><span data-stale={primary?.freshness === "stale" || undefined}>{text}</span>
    </span>;
  })}</span>;
}

export function Shell() {
  const { bootstrap, connection } = useSession();
  const focusedSession = /^\/agents\/[^/]+\/?$/.test(useLocation().pathname);
  const [scope, setScope] = useScope();
  const usage = useProviderUsage();
  const projects = useProjects();
  const canSearch = bootstrap.capability("search.read").enabled;
  const lastTitlePath = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const usageDetails = useRef<HTMLDetailsElement>(null);
  const usageSummary = useRef<HTMLElement>(null);
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
  const status = connection === "connected" && usage.unreachable ? "unreachable" : connection;
  const search = scopeSearch(scope);
  const isMock = import.meta.env.MODE === "mock";

  return (
    <div className={styles.shell} data-focused-session={focusedSession || undefined} data-compact-usage={compactUsage || undefined}>
      <a href="#content" className={styles.skip}>
        Skip to content
      </a>
      <aside className={styles.rail}>
        <p className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            aq
          </span>
          Agent Q
        </p>
        <nav aria-label="Primary" className={styles.railNav}>
          <ul>
            {DESTINATIONS.filter((d) => d.id !== "settings").map((d) => (
              <li key={d.id}>
                <DestinationLink dest={d} search={search} />
              </li>
            ))}
          </ul>
          <ul className={styles.railFooter}>
            <li>
              <DestinationLink dest={destination("settings")} search={search} />
            </li>
          </ul>
        </nav>
        <div className={styles.identity}>
          <span>{bootstrap.principal.displayName}</span>
        </div>
      </aside>
      <header className={styles.top}>
        {isMock && (
          <p className={styles.mockBanner} role="note">
            Mock data · proposed contracts, not a live AQ server
          </p>
        )}
        <div className={styles.scopeRow}>
          <p className={styles.phoneBrand} aria-hidden="true">
            <span className={styles.mark}>aq</span>
            Agent Q
          </p>
          <ScopePicker className={styles.scope} scope={scope} onChange={setScope} projects={projects.data?.view ?? []} />
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
          <summary ref={usageSummary} aria-label="Provider usage (account-wide)"><UsageSummary state={usage.state} /></summary>
          <div className={styles.usageReason}>
            <ProviderUsageStrip state={usage.state} />
            <button type="button" className={styles.button} onClick={closeUsage}>Close usage details</button>
          </div>
        </details>
        <span className={styles.connection} data-state={status} role="status">
          {CONNECTION_TEXT[status]}
        </span>
      </header>
      <main id="content" className={styles.main}>
        <TitleFocusContext value={lastTitlePath}>
          <Outlet />
        </TitleFocusContext>
      </main>
      <PhoneNav search={search} />
      {searchOpen && canSearch && <SearchDialog onClose={closeSearch} />}
    </div>
  );
}
