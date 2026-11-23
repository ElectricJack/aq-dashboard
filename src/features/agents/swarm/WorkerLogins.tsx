import {useQuery} from '@tanstack/react-query';
import {useSession,PANEL_READ} from '../../../app/session';
import {queryKey} from '../../../api/queryKeys';
import {ActionButton} from '../../../components/layout/Workspace';
import { WorkerInstallerHelp, useControlsCommand } from "./WorkerInstallerHelp";
import { useWorkerRequest } from "./workerRequests";
import { readWorkerLogins, type Delivery } from "./workerInspections";
import styles from './WorkerInspector.module.css';
function pendingStatus(connected: boolean, known: boolean) {
  if (connected) return "Claude token queued. Waiting for the worker to install it when idle.";
  return known ? "Claude token queued. Waiting for this worker to reconnect." : "Claude token queued. Waiting for the worker’s login receiver.";
}

function loginStatus(error: boolean, delivery: Delivery | undefined, connected: boolean, known: boolean) {
  if (error) return "Token delivery status is unavailable.";
  switch (delivery?.status) {
    case "applied": return "Installed the Claude token.";
    case "failed": return "Installation failed. Retry Push Claude token.";
    case "pending": return pendingStatus(connected, known);
  }
  if (connected) return "Ready to receive AQ’s saved Claude token.";
  return known ? "Token delivery will resume when this worker reconnects." : "This worker needs the latest installer to receive the Claude token.";
}

export function WorkerLogins({ nodeId }: { nodeId: string }) {
  const { bootstrap } = useSession();
  if (!bootstrap.capability("swarm.worker.control").enabled) return null;
  return <WorkerLoginsPanel nodeId={nodeId} />;
}

function WorkerLoginsPanel({ nodeId }: { nodeId: string }) {
  const { queryContext } = useSession();
  const { busy, error, pending, setError, send } = useWorkerRequest<{ operation_id: string; providers: string[] }>("worker-logins", nodeId);
 const query=useQuery({queryKey:queryKey(queryContext,'worker-logins',{}),queryFn:({signal})=>readWorkerLogins(signal),refetchInterval:5000,retry:false,meta:PANEL_READ});
 const delivery=query.data?.deliveries.find(d=>d.node_id===nodeId);
 const hasReceiver=delivery?.receiver_seen_at_ms != null;
 const receiver=hasReceiver && query.data !== undefined && query.data.server_time_ms - delivery.receiver_seen_at_ms! < 45000;
 const install = useControlsCommand();
 const push = () => send(() => ({ operation_id: crypto.randomUUID(), providers: ["anthropic"] }));
 return <section className={styles.group} aria-label="Claude token">
  <p role="status" className={styles.note}>{loginStatus(query.isError, delivery, receiver, hasReceiver)}</p>
  <p className={styles.note}>Codex needs nothing here. Each Codex agent borrows AQ’s saved Codex login when it starts and returns a refreshed one, so no copy on a worker goes out of date.</p>
  <div className={styles.actions}><ActionButton onClick={()=>void push()} disabled={busy}>{busy?'Sending…':pending?'Retry push':'Push Claude token'}</ActionButton></div>
  {!hasReceiver && <WorkerInstallerHelp command={install} mode="logins" setError={setError} />}
  {error&&<p role="status" className={styles.note}>{error}</p>}
 </section>;
}
