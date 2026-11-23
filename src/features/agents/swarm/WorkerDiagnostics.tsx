import {useQuery} from '@tanstack/react-query';
import {useSession,PANEL_READ} from '../../../app/session';
import {queryKey} from '../../../api/queryKeys';
import {ActionButton} from '../../../components/layout/Workspace';
import { WorkerInstallerHelp, useControlsCommand } from "./WorkerInstallerHelp";
import { useWorkerRequest } from "./workerRequests";
import { readWorkerDiagnostics, type Job, type Receiver, type Report } from "./workerInspections";
import styles from './WorkerInspector.module.css';
function reportText(job: Job, report: Report) {
  if (!report.ok) return `${report.phase ?? "Worker check"}: ${report.error ?? "Check failed."}`;
  if (job.kind === "receiver_update_v1") return "Worker controls updated remotely.";
  return report.details?.network_tools_restored ? "Sandbox startup passed. AQ networking tools were restored." : "Sandbox startup and tmux passed.";
}

function diagnosticsStatus(error: boolean, job: Job | undefined, receiver: Receiver | undefined) {
  if (error) return "Worker diagnostics are unavailable.";
  if (job?.status === "running") return "Worker is running the checks.";
  if (job?.status === "queued") return "Checks queued. Waiting for the worker.";
  if (job?.result) return reportText(job, job.result);
  return receiver ? "Run sandbox checks remotely without opening a terminal." : "One worker update enables remote checks and future remote updates.";
}

function CheckActions({ job, receiver, install, busy, pending, request }: {
  job: Job | undefined; receiver: Receiver | undefined; install: string | null; busy: boolean; pending: boolean;
  request(kind: Job["kind"]): Promise<void>;
}) {
  const active=job?.status==='queued'||job?.status==='running';
  const canUpdate = Boolean(install) && !pending;
  return <div className={styles.actions}><ActionButton disabled={busy||active&&!pending} onClick={()=>void request('sandbox_startup_v1')}>{busy?'Sending…':pending?'Retry request':'Run checks'}</ActionButton>{receiver&&<ActionButton disabled={busy || active || !canUpdate} onClick={()=>void request('receiver_update_v1')}>Update controls</ActionButton>}</div>;
}

export function WorkerDiagnostics({ nodeId }: { nodeId: string }) {
  const { bootstrap } = useSession();
  if (!bootstrap.capability("swarm.worker.control").enabled) return null;
  return <WorkerDiagnosticsPanel nodeId={nodeId} />;
}

function WorkerDiagnosticsPanel({ nodeId }: { nodeId: string }) {
  const { queryContext } = useSession();
  const { busy, error, pending, setError, send } = useWorkerRequest<{ operation_id: string; kind: Job["kind"]; installer_sha256?: string }>("worker-diagnostics", nodeId);
 const query=useQuery({queryKey:queryKey(queryContext,'worker-diagnostics',{}),queryFn:({signal})=>readWorkerDiagnostics(signal),refetchInterval:3000,retry:false,meta:PANEL_READ});
 const job=query.data?.jobs.find(j=>j.node_id===nodeId),receiver=query.data?.receivers.find(r=>r.node_id===nodeId);
 const install = useControlsCommand();
 const request = (kind: Job["kind"]) => send(() => ({
   operation_id: crypto.randomUUID(), kind,
   ...(kind === "receiver_update_v1" ? { installer_sha256: import.meta.env.VITE_AQ_WORKER_INSTALL_SHA256 } : {}),
 }));
 return <section className={styles.group} aria-label="Worker diagnostics">
  <h3>Remote checks</h3>
  <p role="status" className={styles.note}>{diagnosticsStatus(query.isError, job, receiver)}</p>
  <CheckActions job={job} receiver={receiver} install={install} busy={busy} pending={Boolean(pending)} request={request} />
  {!receiver && <WorkerInstallerHelp command={install} mode="diagnostics" setError={setError} />}
  {job?.result?.details&&<details className={styles.more}><summary>Check details</summary><pre className={styles.diagnosticDetails}>{JSON.stringify(job.result.details,null,2)}</pre></details>}
  {error&&<p role="status" className={styles.note}>{error}</p>}
 </section>;
}
