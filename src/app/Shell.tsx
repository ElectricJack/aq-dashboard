import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchDialog } from "../features/search/SearchDialog";
import { NavLink, Outlet, useLocation } from "react-router";
import { Ellipsis, Search } from "lucide-react";
import { DESTINATION_ICON, Icon } from "../components/icons";
import { ProviderUsageStrip } from "../components/ProviderUsageStrip/ProviderUsageStrip";
import { ScopePicker } from "../components/ScopePicker";
import { TitleFocusContext } from "./DestinationPage";
import { DESTINATIONS, PHONE_PRIMARY, destination, type Destination } from "./destinations";
import { scopeSearch, useScope } from "./scope";
import { useSession } from "./session";
import styles from "./Shell.module.css";
import { useProviderUsage } from "./useProviderUsage";

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

export function Shell() {
  const { bootstrap, connection } = useSession();
  const [scope, setScope] = useScope();
  const usage = useProviderUsage();
  const lastTitlePath = useRef<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchButton.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const status = connection === "connected" && usage.unreachable ? "unreachable" : connection;
  const search = scopeSearch(scope);
  const isMock = import.meta.env.MODE === "mock";

  return (
    <div className={styles.shell}>
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
        <p className={styles.phoneBrand} aria-hidden="true">
          <span className={styles.mark}>aq</span>
          Agent Q
        </p>
        <ScopePicker className={styles.scope} scope={scope} onChange={setScope} projects={[]} />
        <button
          ref={searchButton}
          type="button"
          className={styles.search}
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => setSearchOpen(true)}
        >
          <Icon icon={Search} size={18} />
          <span>Search</span>
          <kbd className={styles.kbd} aria-hidden="true">
            Ctrl K
          </kbd>
        </button>
        <ProviderUsageStrip state={usage.state} />
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
      {searchOpen && <SearchDialog onClose={closeSearch} />}
    </div>
  );
}
