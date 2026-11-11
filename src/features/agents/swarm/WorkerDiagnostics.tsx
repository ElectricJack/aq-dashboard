import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiGet,apiSend,ApiError} from '../../../api/client';
import {isRecord,ContractError} from '../../../api/adapters/contract';
import {useSession,PANEL_READ} from '../../../app/session';
import {queryKey} from '../../../api/queryKeys';
import {ActionButton} from '../../../components/layout/Workspace';
import {hostedWorkerCommand} from './AddMachine';
import styles from './Swarm.module.css';
type Report={ok:boolean;phase?:string;error?:string;details?:Record<string,unknown>};
type Job={id:string;node_id:string;kind:'sandbox_startup_v1'|'receiver_update_v1';status:'queued'|'running'|'completed';result:Report|null};
type Receiver={node_id:string;seen_at_ms:number;version:number};
function validJob(raw:unknown):raw is Job{return isRecord(raw)&&typeof raw.id==='string'&&typeof raw.node_id==='string'&&['sandbox_startup_v1','receiver_update_v1'].includes(String(raw.kind))&&['queued','running','completed'].includes(String(raw.status))&&(raw.result===null||isRecord(raw.result)&&typeof raw.result.ok==='boolean'&&(raw.result.phase===undefined||typeof raw.result.phase==='string')&&(raw.result.error===undefined||typeof raw.result.error==='string')&&(raw.result.details===undefined||isRecord(raw.result.details)));}
export function WorkerDiagnostics({nodeId}:{nodeId:string}){
 const {bootstrap,queryContext}=useSession();const client=useQueryClient();const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<{operation_id:string;kind:Job['kind'];installer_sha256?:string}|null>(null);const lock=useRef(false);
 const allowed=bootstrap.capability('swarm.worker.control').enabled;
 const query=useQuery({queryKey:queryKey(queryContext,'worker-diagnostics',{}),queryFn:async({signal})=>{const raw=await apiGet<unknown>('/api/worker-diagnostics',signal);if(!isRecord(raw)||!Array.isArray(raw.jobs)||!raw.jobs.every(validJob)||!Array.isArray(raw.receivers)||!raw.receivers.every(r=>isRecord(r)&&typeof r.node_id==='string'&&typeof r.seen_at_ms==='number'&&typeof r.version==='number')||typeof raw.server_time_ms!=='number')throw new ContractError('Invalid worker diagnostics');return raw as {jobs:Job[];receivers:Receiver[];server_time_ms:number};},enabled:allowed,refetchInterval:3000,retry:false,meta:PANEL_READ});
 if(!allowed)return null;
 const job=query.data?.jobs.find(j=>j.node_id===nodeId),receiver=query.data?.receivers.find(r=>r.node_id===nodeId);
 const active=job?.status==='queued'||job?.status==='running';
 const install=hostedWorkerCommand(import.meta.env.VITE_AQ_WORKER_INSTALL_URL,import.meta.env.VITE_AQ_WORKER_INSTALL_SHA256);
 async function request(kind:Job['kind']){if(lock.current)return;lock.current=true;setBusy(true);setError(null);const change=pending??{operation_id:crypto.randomUUID(),kind,...(kind==='receiver_update_v1'?{installer_sha256:import.meta.env.VITE_AQ_WORKER_INSTALL_SHA256}:{})};setPending(change);try{const receipt=await apiSend<unknown>('POST',`/api/worker-diagnostics/${encodeURIComponent(nodeId)}`,change);if(!isRecord(receipt)||receipt.operation_id!==change.operation_id)throw new ContractError('Invalid worker check receipt');setPending(null);await client.invalidateQueries({predicate:q=>q.queryKey.includes('worker-diagnostics')});}catch(e){if(e instanceof ApiError&&(e.status??0)>=400&&(e.status??0)<500)setPending(null);setError(e instanceof ApiError?e.serverMessage??'Worker check could not be requested.':'Confirmation is pending. Retry the same request.');}finally{setBusy(false);lock.current=false;}}
 return <section className={styles.launch} aria-label="Worker diagnostics">
  <div className={`${styles.actions} ${styles.loginChoices}`}><span>Diagnostics</span><ActionButton disabled={busy||active&&!pending} onClick={()=>void request('sandbox_startup_v1')}>{busy?'Sending…':pending?'Retry request':'Run checks'}</ActionButton>{receiver&&<ActionButton disabled={busy||active||!install||!!pending} onClick={()=>void request('receiver_update_v1')}>Update controls</ActionButton>}</div>
  <p role="status" className={styles.actionNote}>{query.isError?'Worker diagnostics are unavailable.':active?job.status==='running'?'Worker is running the checks.':'Checks queued. Waiting for the worker.':job?.result?job.result.ok?job.kind==='receiver_update_v1'?'Worker controls updated remotely.':'Sandbox startup and tmux passed.':`${job.result.phase??'Worker check'}: ${job.result.error??'Check failed.'}`:receiver?'Run sandbox checks remotely without opening a terminal.':'One worker update enables remote checks and future remote updates.'}</p>
  {!receiver&&install&&<details><summary>Enable remote controls</summary><p className={styles.actionNote}>Open this dashboard on the worker’s PC and run the copied command once in WSL. Enrollment and logins are kept.</p><code className={styles.loginCommand}>{install}</code><ActionButton onClick={()=>{void navigator.clipboard.writeText(install).then(()=>setError('Worker update command copied.'),()=>setError('Copy the command above.'));}}>Copy worker update</ActionButton></details>}
  {job?.result?.details&&<details><summary>Check details</summary><pre className={styles.diagnosticDetails}>{JSON.stringify(job.result.details,null,2)}</pre></details>}
  {error&&<p role="status" className={styles.actionNote}>{error}</p>}
 </section>;
}
