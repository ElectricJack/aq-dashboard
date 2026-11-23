import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { ContractError, isRecord, nullable } from "../../api/adapters/contract";
import type { CapabilityState } from "../../api/adapters/bootstrap";
import { useSession } from "../../app/session";
import { Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { AddMachine } from "../agents/swarm/AddMachine";
import { useWorkerSettings, type Setting } from "../agents/swarm/workerManagementData";
import { Timestamp } from "./Timestamp";
import { OverviewDiagnostics } from "./OverviewDiagnostics";
import styles from "./Settings.module.css";

type Worker = { id: string; name: string; worker_version: string; status: string; last_seen_at: string | null };

function workers(raw: unknown): Worker[] {
  if (!Array.isArray(raw)) throw new ContractError("Invalid worker list");
  return raw.map(workerRecord);
}
function workerRecord(row: unknown): Worker {
  if (!isRecord(row)) throw new ContractError("Invalid worker record");
  const stringField = (key: string) => {
    const value = row[key];
    if (typeof value !== "string") throw new ContractError("Invalid worker record");
    return value;
  };
  if (!nullable(row.last_seen_at, (value): value is string => typeof value === "string")) throw new ContractError("Invalid worker record");
  return { id: stringField("id"), name: stringField("name"), worker_version: stringField("worker_version"), status: stringField("status"), last_seen_at: row.last_seen_at };
}

/** Health strings shown with the success dot; anything else is reported verbatim with a neutral dot. */
const HEALTHY = new Set(["ok", "healthy"]);

export function FrameworkStatus() {
  const management = useWorkerSettings();
  const { bootstrap, queryContext } = useSession();
  const workerCapability = bootstrap.capability("workers.read");
  const statusCapability = bootstrap.capability("status.read");
  const status = useQuery({
    queryKey: queryKey(queryContext, "daemon-status", {}),
    enabled: statusCapability.enabled,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown>("/api/status", signal);
      if (!isRecord(raw) || typeof raw.health !== "string") throw new ContractError("Invalid daemon status");
      return raw.health;
    },
  });
  const roster = useQuery({
    queryKey: queryKey(queryContext, "worker-nodes", {}),
    enabled: workerCapability.enabled,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => workers(await apiGet<unknown>("/api/workers", signal)),
  });
  const currentWorkers = visibleWorkers(roster.data, management.data?.settings);
  const daemon = daemonStatus(statusCapability, status);
  return (
    <Panel className={styles.connection} title="Framework connection" description="AQ daemon health and the worker nodes enrolled with it.">
      <p className={styles.status} data-state={daemon.state} role="status">Daemon: {daemon.text}</p>
      <h3 className={styles.subheading}>Worker nodes</h3>
      {!workerCapability.enabled ? <p className={styles.meta}>{workerCapability.reason}</p> : !currentWorkers ? (
        <QueryStatus status={roster.isError ? "error" : "pending"} error={roster.error} label="worker nodes" onRetry={() => void roster.refetch()} />
      ) : (
        <>
          {roster.isError && <p className={styles.meta} role="status">Refresh failed. These worker observations may be out of date.</p>}
          <WorkerList nodes={currentWorkers} />
        </>
      )}
      <AddMachine />
      <OverviewDiagnostics />
    </Panel>
  );
}


function daemonStatus(capability: CapabilityState, status: { isError: boolean; data?: string }) {
  if (!capability.enabled) return { state: "unknown", text: capability.reason };
  if (status.isError) return { state: "unavailable", text: "Status unavailable" };
  if (status.data === undefined) return { state: "unknown", text: "Checking…" };
  return { state: HEALTHY.has(status.data.toLowerCase()) ? "healthy" : "unknown", text: status.data };
}

function WorkerList({ nodes }: { nodes: Worker[] }) {
  return nodes.length === 0 ? <p className={styles.meta}>No worker nodes enrolled.</p> : (
            <ul className={styles.workers} aria-label="Worker nodes">
              {nodes.map((worker) => (
                <li key={worker.id}>
                  <span><strong>{worker.name}</strong> · {["online", "offline", "revoked"].includes(worker.status) ? worker.status : "Unknown status"} · version {worker.worker_version}</span>
                  <span className={styles.meta}>Last heartbeat: {worker.last_seen_at ? <Timestamp iso={worker.last_seen_at} /> : "Never reported"}</span>
                </li>
              ))}
            </ul>
          );
}


function visibleWorkers(roster: Worker[] | undefined, settings: Setting[] | undefined) {
  const removed = new Set(settings?.filter(setting => setting.kind === "node" && setting.removed).map(setting => setting.id));
  return roster?.filter(worker => worker.status !== "revoked" && !removed.has(worker.id));
}
