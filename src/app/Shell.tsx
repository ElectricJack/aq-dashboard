import { useCallback, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { SupervisorWorkspace } from "../features/supervisor/SupervisorWorkspace";
import { SearchDialog } from "../features/search/SearchDialog";
import { useMediaQuery } from "../components/useMediaQuery";
import { useOnline } from "../components/useOnline";
import { ScopePicker } from "../components/ScopePicker";
import { TitleFocusContext } from "./DestinationPage";
import { DocumentTitleProvider } from "./documentTitle";
import { useBackFocusRestore } from "./focusReturn";
import { navigationDestinations } from "./destinations";
import { HOST_DECISIONS } from "../api/adapters/hostDecisions";
import { scopeSearch, useScope } from "./scope";
import { isFocusedSessionPath } from "./focusedSession";
import { useSession, type Connection } from "./session";
import { BundleNotice } from "./BundleNotice";
import { useProjects } from "./useProjects";
import { useProviderUsage } from "./useProviderUsage";
import { usePendingBadge } from "./usePendingBadge";
import { Rail,TopBar,type ConnectionState } from "./ShellHeader";
import {useShellSearch} from "./useShellSearch";
import { PhoneNav } from "./ShellNavigation";
import styles from "./Shell.module.css";
/** Matches the phone breakpoint in Shell.module.css. */
const PHONE_QUERY = "(max-width: 767px)";
function focusedRoute(location: ReturnType<typeof useLocation>) {
  if (isFocusedSessionPath(location.pathname)) return true;
  if (location.pathname !== "/agents/swarm") return false;
  const params = new URLSearchParams(location.search);
  return params.get("focus") === "terminal" && params.get("select")?.startsWith("agent:");
}
function isCompactUsage(state: ReturnType<typeof useProviderUsage>["state"]) {
  if (state.status === "ready") return false;
  if (state.status === "configured") return state.data.accounts.length === 0;
  return true;
}
function connectionState(connection: Connection, online: boolean, unreachable: boolean): ConnectionState {
  if (connection === "signed_out") return "signed_out";
  if (!online) return "offline";
  return connection === "connected" && !unreachable ? "connected" : "reconnecting";
}
export function Shell() {
  const { bootstrap, connection } = useSession();
  const hostDecisions = bootstrap.capability(HOST_DECISIONS).enabled;
  const destinations = navigationDestinations(hostDecisions);
  const location = useLocation();
  const focusedSession = focusedRoute(location);
  const [scope, setScope] = useScope();
  const usage = useProviderUsage();
  const projects = useProjects();
  const canSearch = bootstrap.capability("search.read").enabled;
  const lastTitlePath = useRef<string | null>(null);
  const content = useRef<HTMLElement>(null);
  useBackFocusRestore(useCallback(() => content.current, []));
  const searchAction = useShellSearch(canSearch);
  const compactUsage = isCompactUsage(usage.state);
  const online = useOnline();
  const status = connectionState(connection, online, usage.unreachable);
  const phone = useMediaQuery(PHONE_QUERY);
  const badge = usePendingBadge(scope, bootstrap.capability("dashboard.overview").enabled && !hostDecisions);
  const name = bootstrap.principal.displayName;
  const search = scopeSearch(scope);
  const scopePicker = (
    <ScopePicker
      className={styles.scope}
      scope={scope}
      onChange={setScope}
      projects={projects.data?.view ?? []}
      projectsLoaded={!!projects.data}
    />
  );
  const nav = { phone, scopePicker, name, status, search };
  return (
    <div
      className={styles.shell}
      data-focused-session={focusedSession || undefined}
      data-compact-usage={compactUsage || undefined}
    >
      <a href="#content" className={styles.skip}>
        Skip to content
      </a>
      <Rail {...nav} badge={badge} destinations={destinations} />
      <TopBar {...nav} canSearch={canSearch} usage={usage} searchAction={searchAction} />
      <main id="content" ref={content} className={styles.main}>
        <BundleNotice />
        <TitleFocusContext value={lastTitlePath}>
          <DocumentTitleProvider>
            <SupervisorWorkspace>
              <Outlet />
            </SupervisorWorkspace>
          </DocumentTitleProvider>
        </TitleFocusContext>
      </main>
      <PhoneNav search={search} badge={badge} destinations={destinations} />
      {searchAction.searchOpen && canSearch && <SearchDialog onClose={searchAction.closeSearch} />}
    </div>
  );
}
