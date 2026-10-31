import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";

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
  return (
    <section aria-labelledby="framework-heading">
      <h2 id="framework-heading">Framework connection</h2>
      {statusCapability.enabled && <p>Daemon: {status.isError ? "Status unavailable" : status.data ?? "Checking…"}</p>}
      <h3>Worker nodes</h3>
      {!workerCapability.enabled ? <p>{workerCapability.reason}</p> : !roster.data ? (
        <QueryStatus status={roster.isError ? "error" : "pending"} error={roster.error} label="worker nodes" onRetry={() => void roster.refetch()} />
      ) : (
        <>
          {roster.isError && <p role="status">Refresh failed. These worker observations may be out of date.</p>}
          {roster.data.length === 0 ? <p>No worker nodes enrolled.</p> : (
            <ul aria-label="Worker nodes">
              {roster.data.map((worker) => (
                <li key={worker.id}>
                  <strong>{worker.name}</strong> · {["online", "offline", "revoked"].includes(worker.status) ? worker.status : "Unknown status"} · version {worker.worker_version}
                  <p>Last heartbeat: {worker.last_seen_at ?? "Never reported"}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
