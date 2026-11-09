import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { useSession } from "../../app/session";
import { Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { AddMachine } from "../agents/swarm/AddMachine";
import { Timestamp } from "./Timestamp";
import { OverviewDiagnostics } from "./OverviewDiagnostics";
import styles from "./Settings.module.css";

type Worker = { id: string; name: string; worker_version: string; status: string; last_seen_at: string | null };

function workers(raw: unknown): Worker[] {
  if (!Array.isArray(raw)) throw new ContractError("Invalid worker list");
  return raw.map((row: unknown) => {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string" ||
      typeof row.worker_version !== "string" || typeof row.status !== "string" ||
      !(row.last_seen_at === null || typeof row.last_seen_at === "string")) {
      throw new ContractError("Invalid worker record");
    }
    return { id: row.id, name: row.name, worker_version: row.worker_version, status: row.status, last_seen_at: row.last_seen_at };
  });
}

/** Health strings shown with the success dot; anything else is reported verbatim with a neutral dot. */
const HEALTHY = new Set(["ok", "healthy"]);

export function FrameworkStatus() {
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
  const currentWorkers = roster.data?.filter(worker => worker.status !== "revoked");
  const daemon = !statusCapability.enabled
    ? { state: "unknown", text: statusCapability.reason }
    : status.isError ? { state: "unavailable", text: "Status unavailable" }
      : status.data === undefined ? { state: "unknown", text: "Checking…" }
        : { state: HEALTHY.has(status.data.toLowerCase()) ? "healthy" : "unknown", text: status.data };
  return (
    <Panel className={styles.connection} title="Framework connection" description="AQ daemon health and the worker nodes enrolled with it.">
      <p className={styles.status} data-state={daemon.state} role="status">Daemon: {daemon.text}</p>
      <h3 className={styles.subheading}>Worker nodes</h3>
      {!workerCapability.enabled ? <p className={styles.meta}>{workerCapability.reason}</p> : !currentWorkers ? (
        <QueryStatus status={roster.isError ? "error" : "pending"} error={roster.error} label="worker nodes" onRetry={() => void roster.refetch()} />
      ) : (
        <>
          {roster.isError && <p className={styles.meta} role="status">Refresh failed. These worker observations may be out of date.</p>}
          {currentWorkers.length === 0 ? <p className={styles.meta}>No worker nodes enrolled.</p> : (
            <ul className={styles.workers} aria-label="Worker nodes">
              {currentWorkers.map((worker) => (
                <li key={worker.id}>
                  <span><strong>{worker.name}</strong> · {["online", "offline", "revoked"].includes(worker.status) ? worker.status : "Unknown status"} · version {worker.worker_version}</span>
                  <span className={styles.meta}>Last heartbeat: {worker.last_seen_at ? <Timestamp iso={worker.last_seen_at} /> : "Never reported"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <AddMachine />
      <OverviewDiagnostics />
    </Panel>
  );
}
