import { X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import type { MachineView, NodeView } from "../../../api/adapters/swarm";
import { useSession } from "../../../app/session";
import { ActionButton, DetailList } from "../../../components/layout/Workspace";
import { formatAge } from "../../../components/time/relative";
import { HostTerminalAction } from "../host/HostTerminalAction";
import { WorkerDiagnostics } from "./WorkerDiagnostics";
import { WorkerLaunch } from "./WorkerLaunch";
import { WorkerLogins } from "./WorkerLogins";
import { WorkerManagement } from "./WorkerManagement";
import { busyOf, nodeBusy, nodeStanding, type Standing } from "./slots";
import paneStyles from "./Swarm.module.css";
import styles from "./WorkerInspector.module.css";

const STATUS: Record<Standing | "online", string> = {
  online: "Online",
  holding: "Holding",
  draining: "Draining",
  stopped: "Stopped",
  offline: "Offline",
  booting: "Booting",
  revoked: "Revoked",
  unknown: "Status unknown",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
  { id: "logins", label: "Logins" },
  { id: "diagnostics", label: "Diagnostics" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function SlotCounts({ slots, state, scope, showScopedCount }: {
  slots: NodeView["slots"]; state: Standing | "online"; scope: NodeView["slots"]["scope"]; showScopedCount: boolean;
}) {
  return <>
        {showScopedCount && <p className={styles.note}>{scope} · {slots.total === null ? "Capacity not reported" : busyOf(slots.occupied, slots.total)}</p>}
        {slots.idle !== null && <p className={styles.note}>
          {slots.idle} {state === "online" ? "available" : "idle"}{scope === "Across projects" ? " across projects" : scope ? ` · ${scope}` : ""}
        </p>}
        {slots.target !== undefined && <p className={styles.note}>Draining to {slots.target} project slots</p>}
  </>;
}

function WorkerCapacity({ node, machine, maximum, state }: {
  node: NodeView; machine: MachineView; maximum: number | null; state: Standing | "online";
}) {
  const { slots } = node;
  const scope = slots.scope === "All projects" ? "Across projects" : slots.scope;
  const busy = nodeBusy(machine, node);
  const showScopedCount = scope && (maximum !== slots.total || busy !== slots.occupied);
  return <section className={styles.overview} aria-label="Worker capacity">
        {node.holding.length > 0 && <ul className={styles.holds}>
          {node.holding.map(hold => <li key={hold.code}>
            <strong>{hold.message}</strong>
            {hold.remedy && <p className={styles.note}>{hold.remedy}</p>}
          </li>)}
        </ul>}
        <div className={`${styles.actions} ${styles.capacityRow}`}>
          <div>
            <h3>Worker capacity</h3>
            <p className={styles.slots}>{maximum === null ? "Capacity not reported" : busyOf(busy, maximum)}</p>
          </div>
          <HostTerminalAction nodeId={node.id} />
        </div>
        <SlotCounts slots={slots} state={state} scope={scope} showScopedCount={Boolean(showScopedCount)} />
      </section>;
}

function useWorkerTabs(canManage: boolean) {
  const tabs = canManage ? TABS : TABS.filter(({ id }) => id === "overview" || id === "diagnostics");
  const [selectedTab, setSelectedTab] = useState<Tab>("overview");
  const activeTab = tabs.some(({ id }) => id === selectedTab) ? selectedTab : "overview";
  const tabId = useId();
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(({ id }) => id === activeTab);
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setSelectedTab(tabs[next]!.id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  function panelProps(tab: Tab) {
    return { role: "tabpanel" as const, className: styles.tabPanel, id: `${tabId}-${tab}-panel`,
      "aria-labelledby": `${tabId}-${tab}`, hidden: tab !== activeTab, tabIndex: 0 };
  }

  return { tabs, activeTab, tabId, navigateTabs, setSelectedTab, panelProps };
}

function RuntimeDetails({ node }: { node: NodeView }) {
  return <DetailList className={styles.runtime}>
          <dt>Backend</dt><dd>{node.backendKind ?? "Unknown"}</dd>
          <dt>Service</dt><dd>{node.service === "unreported" ? "Not reported" : node.service}</dd>
          <dt>Version</dt><dd>aq-worker {node.workerVersion}</dd>
          <dt>Sandbox image</dt><dd>{node.sandboxTemplates.length ? node.sandboxTemplates.map(image =>
            <div key={image}><code>{image}</code></div>) : "None advertised"}</dd>
          <dt>Agent channel</dt><dd>{node.agentChannel === "unreported" ? "Not reported" : node.agentChannel}</dd>
        </DetailList>;
}

export function WorkerInspector({ node, machine, serverTime, onClose }: {
  node: NodeView; machine: MachineView; serverTime: string; onClose(): void;
}) {
  const { bootstrap, queryContext } = useSession();
  const canManage = bootstrap.capability("swarm.worker.control").enabled;
  const canLaunch = bootstrap.capability("tasks.create").enabled;
  const { tabs, activeTab, tabId, navigateTabs, setSelectedTab, panelProps } = useWorkerTabs(canManage);
  const state = nodeStanding(machine, node).standing ?? "online";
  const maximum = node.capacity ?? (node.slots.scope ? null : node.slots.total);

  return <div className={styles.inspector}>
    <header className={`${paneStyles.paneHead} ${styles.header}`}>
      <div>
        <div className={paneStyles.kicker}>Worker node</div>
        <h2 className={paneStyles.paneTitle} tabIndex={-1}>{node.name}</h2>
        <div className={styles.health}>
          <span className={styles.note}>{machine.label}</span>
          <span className={styles.status} data-state={state}>{STATUS[state]}</span>
          <span className={styles.note}>Heartbeat {node.lastSeenAt ? formatAge(serverTime, node.lastSeenAt) : "never received"}</span>
        </div>
      </div>
      <ActionButton className={styles.close} aria-label="Close worker details" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </ActionButton>
    </header>

    <div className={styles.tabs} role="tablist" aria-label="Worker details" onKeyDown={navigateTabs}>
      {tabs.map(({ id, label }) => <button key={id} id={`${tabId}-${id}`} type="button" role="tab"
        aria-controls={`${tabId}-${id}-panel`} aria-selected={activeTab === id}
        tabIndex={activeTab === id ? 0 : -1} onClick={() => setSelectedTab(id)}>{label}</button>)}
    </div>

    <div {...panelProps("overview")}>
      <WorkerCapacity node={node} machine={machine} maximum={maximum} state={state} />

      {canLaunch && <WorkerLaunch key={`${queryContext.principalId}:${queryContext.authorizationRevision}`} node={node} canPushLogins={canManage} />}
    </div>

    {canManage && <>
      <div {...panelProps("settings")}>
        <div className={styles.sectionBody}>
          <WorkerManagement kind="node" id={node.id} name={node.name} maximum={maximum} />
        </div>
      </div>
      <div {...panelProps("logins")}><div className={styles.sectionBody}><WorkerLogins nodeId={node.id} /></div></div>
    </>}
    <div {...panelProps("diagnostics")}>
      <div className={styles.sectionBody}>
        <RuntimeDetails node={node} />
        {canManage && <WorkerDiagnostics nodeId={node.id} />}
        <div className={styles.group}>
          <h3>Service controls</h3>
          <div className={styles.actions}>
            {["Drain node", "Restart", "View logs"].map(label => <ActionButton key={label} disabled>{label}</ActionButton>)}
          </div>
          <p className={styles.note}>{canManage ? "Use the machine’s controls to manage the worker service." : "Worker service controls are unavailable on this server."}</p>
        </div>
      </div>
    </div>
  </div>;
}
