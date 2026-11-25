import { useEffect, useState, type KeyboardEvent, type ReactElement } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { ProjectBindings } from "./ProjectBindings";
import { FrameworkStatus } from "./FrameworkStatus";
import { DisplayPreferences } from "./DisplayPreferences";
import { Providers } from "./Providers";
import { Roles } from "./Roles";
import { IntelligenceLevels } from "./IntelligenceLevels";
import { ExecutionProfiles } from "./ExecutionProfiles";
import { SelectionDefaults } from "./SelectionDefaults";
import { InternalWorkSettings } from "./InternalWorkSettings";
import { DeliverySettings } from "./DeliverySettings";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";
import { RoutingDocumentDraftProvider } from "./RoutingDocumentDraft";
import { ProfileSnapshotNote } from "./ProfileDocuments";
import { Notifications } from "../notifications/Notifications";
import { IntelligenceDraftProvider, useIntelligenceDrafts } from "./IntelligenceDrafts";
import styles from "./Settings.module.css";

const TABS = [
  { id: "identity", label: "Identity" }, { id: "display", label: "Display" },
  { id: "providers", label: "Providers" }, { id: "roles", label: "Roles" }, { id: "intelligence", label: "Intelligence" }, { id: "execution", label: "Execution" },
  { id: "delivery", label: "Delivery" },
  { id: "connection", label: "Connection" },
  { id: "projects", label: "Projects" }, { id: "notifications", label: "Notifications" },
] as const;
type Tab = typeof TABS[number]["id"];
/** Tabs that hold drafts: once opened they stay mounted, so switching tabs does not lose unsaved text. */
const DRAFT_TABS: readonly Tab[] = ["providers", "roles", "intelligence", "execution", "delivery"];
function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number, select: (tab: Tab) => void) {
  let next: number;
  switch (event.key) {
    case "Home": next = 0; break;
    case "End": next = TABS.length - 1; break;
    case "ArrowRight": next = (index + 1) % TABS.length; break;
    case "ArrowLeft": next = (index + TABS.length - 1) % TABS.length; break;
    default: return;
  }
  event.preventDefault();
  const target = TABS[next]!.id;
  select(target);
  document.getElementById(`settings-tab-${target}`)?.focus();
}

function Identity() {
  const { bootstrap } = useSession();
  return <Panel title="Identity" description="The account this dashboard is signed in with.">
          <DetailList><dt>Signed in as</dt><dd>{bootstrap.principal.displayName}</dd></DetailList>
          <details className={styles.technical}><summary>Technical identity</summary><DetailList><dt>AQ version</dt><dd>{bootstrap.productVersion}</dd></DetailList></details>
        </Panel>;
}

const tabContents: Record<Tab, ReactElement> = {
  providers: <Providers />,
  roles: <><Roles /><ProfileSnapshotNote scope="roles" /></>,
  intelligence: <><h2 className={styles.sectionTitle}>Intelligence</h2>
          <IntelligenceLevels /><SelectionDefaults /><ProfileSnapshotNote scope="intelligence" />
          <div className={styles.sections}><InternalWorkSettings /><RoutingDocumentDraftProvider><RoutingPolicyEditor /></RoutingDocumentDraftProvider></div></>,
  execution: <><ExecutionProfiles /><ProfileSnapshotNote scope="execution" /></>,
  delivery: <DeliverySettings />,
  identity: <Identity />,
  display: <DisplayPreferences />,
  connection: <FrameworkStatus />,
  projects: <ProjectBindings />,
  notifications: <Notifications />,
};

export function Component() { return <IntelligenceDraftProvider><SettingsContent /></IntelligenceDraftProvider>; }
function useSettingsTabs() {
  const [params] = useSearchParams(); const { hash } = useLocation(); const navigate = useNavigate();
  const requested = params.get("tab") ?? (hash === "#overview-diagnostics" ? "connection" : "identity");
  const selected: Tab = TABS.find(tab => tab.id === requested)?.id ?? "identity";
  const [visited, setVisited] = useState<readonly Tab[]>([selected]);
  useEffect(() => { setVisited(old => old.includes(selected) ? old : [...old, selected]); }, [selected]);
  useEffect(() => { document.getElementById(`settings-tab-${selected}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [selected]);
  function select(id: Tab) {
    const next = new URLSearchParams(params); next.set("tab", id);
    void navigate({ pathname: "/settings", search: `?${next}`, hash: "" });
  }
  return { selected, select, visited };
}

function SettingsContent() {
  const drafts = useIntelligenceDrafts();
  const { selected, select, visited } = useSettingsTabs();
  return <DestinationPage id="settings">
    <div className={styles.pageToolbar}><p className={styles.subtitle}>Manage your account, display, providers, roles, intelligence levels, execution profiles and connected workers.</p><ActionButton disabled={!drafts.dirty || drafts.saving || drafts.locked} onClick={() => void drafts.saveAll()}>{drafts.saving ? "Saving…" : "Save"}</ActionButton></div>
    {drafts.message && (drafts.message !== "Saved." || !drafts.dirty) && <p role="status" aria-label={selected === "intelligence" ? "Intelligence save status" : "Settings save status"} className={styles.meta}>{drafts.message}</p>}
    <div className={styles.tabs} role="tablist" aria-label="Settings sections">
      {TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-controls={`settings-panel-${tab.id}`}
        aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => navigateTabs(event, index, select)}>{tab.label}</button>)}
    </div>
    {TABS.map(tab => <section key={tab.id} role="tabpanel" id={`settings-panel-${tab.id}`} aria-labelledby={`settings-tab-${tab.id}`} hidden={selected !== tab.id} className={styles.tabPanel}>
      {(selected === tab.id || (DRAFT_TABS.includes(tab.id) && visited.includes(tab.id))) && tabContents[tab.id]}
    </section>)}
  </DestinationPage>;
}
