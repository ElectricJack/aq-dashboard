import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { DetailList, Panel } from "../../components/layout/Workspace";
import { ProjectBindings } from "./ProjectBindings";
import { FrameworkStatus } from "./FrameworkStatus";
import { DisplayPreferences } from "./DisplayPreferences";
import { IntelligenceSettings } from "./intelligence";
import { SwarmSettings } from "./SwarmSettings";
import { Notifications } from "../notifications/Notifications";
import styles from "./Settings.module.css";

const TABS = [
  { id: "identity", label: "Identity" }, { id: "display", label: "Display" },
  { id: "intelligence", label: "Intelligence" }, { id: "swarm", label: "Swarm" }, { id: "connection", label: "Connection" },
  { id: "projects", label: "Projects" }, { id: "notifications", label: "Notifications" },
] as const;
type Tab = typeof TABS[number]["id"];
export function Component() {
  const { bootstrap } = useSession(); const [params] = useSearchParams(); const { hash } = useLocation(); const navigate = useNavigate();
  const requested = hash === "#swarm" ? "swarm" : params.get("tab") ?? (hash === "#overview-diagnostics" ? "connection" : "identity");
  const selected: Tab = TABS.find(tab => tab.id === requested)?.id ?? "identity";
  const [visitedIntelligence, setVisitedIntelligence] = useState(selected === "intelligence");
  const [visitedSwarm, setVisitedSwarm] = useState(selected === "swarm");
  useEffect(() => { if (selected === "intelligence") setVisitedIntelligence(true); }, [selected]);
  useEffect(() => { if (selected === "swarm") setVisitedSwarm(true); }, [selected]);
  useEffect(() => { document.getElementById(`settings-tab-${selected}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [selected]);
  function select(id: Tab) {
    const next = new URLSearchParams(params); next.set("tab", id);
    void navigate({ pathname: "/settings", search: `?${next}`, hash: "" });
  }
  return <DestinationPage id="settings">
    <p className={styles.subtitle}>Manage your account, display, intelligence profiles, swarm limits and connected workers.</p>
    <div className={styles.tabs} role="tablist" aria-label="Settings sections">
      {TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-controls={`settings-panel-${tab.id}`}
        aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={event => {
          const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!direction && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault(); const target = TABS[event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + direction + TABS.length) % TABS.length]!;
          select(target.id); document.getElementById(`settings-tab-${target.id}`)?.focus();
        }}>{tab.label}</button>)}
    </div>
    {TABS.map(tab => <section key={tab.id} role="tabpanel" id={`settings-panel-${tab.id}`} aria-labelledby={`settings-tab-${tab.id}`} hidden={selected !== tab.id} className={styles.tabPanel}>
      {tab.id === "intelligence" ? ((selected === tab.id || visitedIntelligence) && <><h2 className={styles.sectionTitle}>Intelligence profiles</h2><IntelligenceSettings /></>) : tab.id === "swarm" ? ((selected === tab.id || visitedSwarm) && <div id="swarm"><h2 className={styles.sectionTitle}>Swarm</h2><SwarmSettings /></div>) : selected === tab.id && <>
        {tab.id === "identity" && <Panel title="Identity" description="The account this dashboard is signed in with.">
          <DetailList><dt>Signed in as</dt><dd>{bootstrap.principal.displayName}</dd></DetailList>
          <details className={styles.technical}><summary>Technical identity</summary><DetailList><dt>AQ version</dt><dd>{bootstrap.productVersion}</dd></DetailList></details>
        </Panel>}
        {tab.id === "display" && <DisplayPreferences />}
        {tab.id === "connection" && <FrameworkStatus />}
        {tab.id === "projects" && <ProjectBindings />}
        {tab.id === "notifications" && <Notifications />}
      </>}
    </section>)}
  </DestinationPage>;
}
