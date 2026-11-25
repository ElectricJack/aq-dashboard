import { Link } from "react-router";
import { adaptSwarm, type SwarmView } from "../../api/adapters/swarm";
import type { Swarm } from "../../api/wire/swarm";
import { PANEL_READ, useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { useRead, type Read } from "../../app/useRead";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { fleetSlots, formatBytes, formatFreePercent, machineCapacity, RESOURCES, tightestHeadroom, type MachineCapacity } from "./capacity";
import { PinnedSessions } from "./PinnedSessions";
import styles from "./Overview.module.css";

function SlotSummary({ slots }: { slots: ReturnType<typeof fleetSlots> }) {
  const segments = [
    { kind: "open", count: slots.open, label: "open" },
    { kind: "inUse", count: slots.inUse, label: "in use" },
    { kind: "held", count: slots.held, label: "unavailable" },
  ];
  const visible = segments.filter(segment => segment.count > 0);
  return <>
    <p className={styles.capacityValue}>
      {slots.incomplete && slots.open === 0
        ? "Open slots unknown"
        : <><strong>{slots.incomplete ? `${slots.open}+` : slots.open}</strong> {slots.open === 1 && !slots.incomplete ? "open agent slot" : "open agent slots"}</>}
    </p>
    {visible.length > 0 && <div className={styles.slotBar} aria-hidden="true">
      {visible.map(segment => <span key={segment.kind} data-kind={segment.kind} style={{ flexGrow: segment.count }} />)}
    </div>}
    {visible.length > 0 && <ul className={styles.slotLegend} aria-label="Reported slots">
      {visible.map(segment =>
        <li key={segment.kind} data-kind={segment.kind}>{segment.count} {segment.label}</li>)}
    </ul>}
    {slots.incomplete && <p className={styles.meta}>Slot counts are incomplete.</p>}
  </>;
}

function MachineResources({ headroom }: { headroom: MachineCapacity["headroom"] }) {
  return <dl className={styles.machineResources}>
          {RESOURCES.filter(resource => resource !== "GPU").map(resource => {
            const reading = headroom[resource];
            return <div key={resource}>
              <dt>{resource}</dt>
              <dd>{reading === undefined ? "Not reported" : formatFreePercent(reading.percent)}</dd>
              {reading?.freeBytes !== undefined && <dd>{resource === "Memory" && "~"}{formatBytes(reading.freeBytes)}</dd>}
            </div>;
          })}
        </dl>;
}

function FleetHeadroom({ machines }: { machines: MachineCapacity[] }) {
  return <section className={styles.resourceSection} aria-labelledby="overview-headroom-heading">
      <h3 id="overview-headroom-heading">Tightest reported headroom</h3>
      <ul className={styles.resourceGrid}>
        {RESOURCES.map(resource => {
          const lowest = tightestHeadroom(machines, resource);
          return <li key={resource}>
            <div className={styles.resourceValue}>
              <strong>{resource}</strong>
              <span>{lowest ? formatFreePercent(lowest.reading.percent) : "Not reported"}</span>
            </div>
            {lowest && <>
              <span className={styles.resourceBar} aria-hidden="true">
                <span style={{ inlineSize: `${lowest.reading.percent}%` }} />
              </span>
              <span className={styles.meta}>{lowest.machine}</span>
            </>}
          </li>;
        })}
      </ul>
    </section>;
}

function MachineDetails({ machines }: { machines: MachineCapacity[] }) {
  return <details className={styles.capacityDetails}>
    <summary>By machine <span className={styles.meta}>({machines.length})</span></summary>
    <ul className={styles.capacityMachines}>
      {machines.map(({ id, name, slots, holds, headroom, loadLabel }) => <li key={id}>
        <strong>{name}</strong>
        <p className={styles.meta}>
          {slots.open > 0 || !slots.incomplete ? `${slots.open}${slots.incomplete ? "+" : ""} open` : "Open slots unknown"}
          {" · "}{slots.inUse} in use{slots.held > 0 && ` · ${slots.held} unavailable`}
        </p>
        {holds.length > 0 && <p className={styles.capacityHold}>{holds.join(" · ")}</p>}
        <MachineResources headroom={headroom} />
        {loadLabel && <p className={styles.meta}>{loadLabel}</p>}
      </li>)}
    </ul>
  </details>;
}

function CapacityRead({ view, coverage }: Read<SwarmView>) {
  const paused = view.server.ownerAvailability?.state === "off";
  const machines = view.machines.flatMap(machine => machineCapacity(machine, paused) ?? []);
  const incomplete = coverage.state !== "complete" || view.machines.some(machine =>
    machine.nodes.some(node => node.health === "unknown"));
  if (machines.length === 0) {
    return <p className={styles.meta}>{incomplete ? "No online workers reported. Fleet data is incomplete." : "No workers online."}</p>;
  }
  const slots = fleetSlots(machines, incomplete);
  const holds = [...new Set(machines.flatMap(machine => machine.holds))];
  return <>
    <SlotSummary slots={slots} />
    {paused ? <p className={styles.capacityHold}>Owner availability is off.</p>
      : slots.open === 0 && slots.held > 0 && holds.length === 1
        ? <p className={styles.capacityHold}>{holds[0]}</p>
        : <p className={styles.meta}>Launches also depend on project, provider, and worker readiness.</p>}
    <FleetHeadroom machines={machines} />
    <MachineDetails machines={machines} />
  </>;
}

export function Infrastructure() {
  const { bootstrap, queryContext } = useSession();
  const [scope] = useScope();
  const capability = bootstrap.capability("swarm.read");
  const swarm = useRead<Swarm, SwarmView>({
    resource: "swarm", path: "/api/v1/swarm", adapt: adaptSwarm, pollMs: 4_000,
    enabled: capability.enabled, meta: PANEL_READ,
  });

  return <aside className={styles.secondary} aria-label="Infrastructure observations">
    <section className={`${styles.panel} ${styles.capacityPanel}`} aria-labelledby="overview-capacity-heading">
      <div className={styles.capacityHeader}>
        <h2 id="overview-capacity-heading">Capacity</h2>
        {capability.enabled && <Link to={{ pathname: "/agents/swarm", search: scopeSearch(scope) }}>Open Swarm <span aria-hidden="true">→</span></Link>}
      </div>
      {!capability.enabled ? <p className={styles.meta}>{capability.reason}</p>
        : swarm.data ? <>
          {/* The page already says when the browser is offline; this panel only reports its own failed refresh. */}
          <RetainedNotice query={swarm} className={styles.warning} showOffline={false} />
          <p className={styles.meta}>Installation-wide</p>
          <CapacityRead {...swarm.data} />
        </> : <QueryStatus status={swarm.isError ? "error" : "pending"} error={swarm.error} label="fleet capacity" onRetry={() => void swarm.refetch()} />}
    </section>
    <PinnedSessions key={JSON.stringify([queryContext, scope])} />
  </aside>;
}
