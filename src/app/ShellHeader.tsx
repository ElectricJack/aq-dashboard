import {useEffect,useRef,type ReactNode} from "react";
import {Link} from "react-router";
import {ChevronDown,LayoutGrid,Search} from "lucide-react";
import {Icon} from "../components/icons";
import {ProviderUsageStrip,ProviderUsageSummary} from "../components/ProviderUsageStrip/ProviderUsageStrip";
import {DestinationLink} from "./ShellNavigation";
import {destination,type Destination} from "./destinations";
import type {useProviderUsage} from "./useProviderUsage";
import type {Badge} from "./usePendingBadge";
import type {useShellSearch} from "./useShellSearch";
import styles from "./Shell.module.css";
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

/** Bootstrap keeps polling while AQ is unreachable, so that state is a reconnect attempt. */
const CONNECTION_TEXT = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  signed_out: "Sign-in expired",
} as const;
export type ConnectionState = keyof typeof CONNECTION_TEXT;

function ConnectionStatus({ state, className }: { state: ConnectionState; className?: string }) {
  return (
    <span className={className} data-state={state} role="status">
      {CONNECTION_TEXT[state]}
    </span>
  );
}

function UsageDetails({ usage }: { usage: ReturnType<typeof useProviderUsage> }) {
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
      if (!details?.open) return;
      if (event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      ref={usageDetails}
      className={styles.compactUsage}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeUsage();
        }
      }}
    >
      <summary ref={usageSummary}>
        <span className="visually-hidden">Provider usage (account-wide) </span>
        <ProviderUsageSummary state={usage.state} />
        <Icon icon={ChevronDown} size={16} className={styles.usageChevron} />
      </summary>
      <div className={styles.usageReason}>
        <ProviderUsageStrip state={usage.state} />
        <button type="button" className={styles.button} onClick={closeUsage}>
          Close usage details
        </button>
      </div>
    </details>
  );
}
type NavProps = {
  phone: boolean;
  scopePicker: ReactNode;
  name: string;
  status: ConnectionState;
  search: string;
};
export function Rail({
  phone,
  scopePicker,
  name,
  status,
  search,
  badge,
  destinations,
}: NavProps & { badge: Badge | null; destinations: readonly Destination[] }) {
  return (
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
          {destinations
            .filter((d) => d.id !== "settings")
            .map((d) => (
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
  );
}
export function TopBar({
  phone,
  scopePicker,
  name,
  status,
  search,
  canSearch,
  usage,
  searchAction,
}: NavProps & {
  canSearch: boolean;
  usage: ReturnType<typeof useProviderUsage>;
  searchAction: ReturnType<typeof useShellSearch>;
}) {
  const { searchButton, setSearchOpen } = searchAction;
  const isMock = import.meta.env.MODE === "mock";
  return (
    <header className={styles.top}>
      {isMock && (
        <p
          className={styles.mockBanner}
          role="note"
          title="Mock data · proposed contracts, not a live AQ server"
        >
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
      <UsageDetails usage={usage} />
      {phone && <ConnectionStatus state={status} className={styles.connection} />}
      <Link to={{ pathname: "/settings", search }} className={styles.avatarLink}>
        <Avatar name={name} />
        <span className={styles.srOnly}>Settings, signed in as {name}</span>
      </Link>
    </header>
  );
}
