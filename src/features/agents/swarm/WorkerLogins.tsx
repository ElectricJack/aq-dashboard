import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiGet,apiSend,ApiError} from '../../../api/client';
import {isRecord,ContractError} from '../../../api/adapters/contract';
import {useSession,PANEL_READ} from '../../../app/session';
import {queryKey} from '../../../api/queryKeys';
import {ActionButton} from '../../../components/layout/Workspace';
import {hostedWorkerCommand,useWorkerInstaller} from './AddMachine';
import styles from './WorkerInspector.module.css';
type Delivery={node_id:string;generation:string|null;providers:string[];status:'waiting'|'pending'|'applied'|'failed';receiver_seen_at_ms:number|null};
function valid(raw:unknown):raw is Delivery{return isRecord(raw)&&typeof raw.node_id==='string'&&(raw.generation===null||typeof raw.generation==='string')&&Array.isArray(raw.providers)&&raw.providers.every(p=>p==='anthropic'||p==='openai')&&['waiting','pending','applied','failed'].includes(String(raw.status))&&(raw.receiver_seen_at_ms===null||typeof raw.receiver_seen_at_ms==='number');}
/** Pushes AQ's saved Claude token to a worker. A Codex login is never installed on a worker: each Codex agent leases the saved login from the server when it starts. */
export function WorkerLogins({nodeId}:{nodeId:string}){
 const {bootstrap,queryContext}=useSession();const client=useQueryClient();const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<{operation_id:string;providers:string[]}|null>(null);const lock=useRef(false);
 const allowed=bootstrap.capability('swarm.worker.control').enabled;
 const query=useQuery({queryKey:queryKey(queryContext,'worker-logins',{}),queryFn:async({signal})=>{const raw=await apiGet<unknown>('/api/worker-logins',signal);if(!isRecord(raw)||!Array.isArray(raw.deliveries)||!raw.deliveries.every(valid)||typeof raw.server_time_ms!=='number')throw new ContractError('Invalid login delivery status');return raw as {deliveries:Delivery[];server_time_ms:number};},enabled:allowed,refetchInterval:5000,retry:false,meta:PANEL_READ});
 if(!allowed)return null;
 const delivery=query.data?.deliveries.find(d=>d.node_id===nodeId);
 const hasReceiver=delivery?.receiver_seen_at_ms!==null&&delivery?.receiver_seen_at_ms!==undefined;
 const receiver=hasReceiver&&!!query.data&&query.data.server_time_ms-delivery!.receiver_seen_at_ms!<45000;
 const installer=useWorkerInstaller();const install=hostedWorkerCommand(installer.origin,installer.digest,true);
 async function push(){if(lock.current)return;lock.current=true;setBusy(true);setError(null);const request=pending??{operation_id:crypto.randomUUID(),providers:['anthropic']};setPending(request);try{const receipt=await apiSend<unknown>('POST',`/api/worker-logins/${encodeURIComponent(nodeId)}`,request);if(!isRecord(receipt)||receipt.generation!==request.operation_id)throw new ContractError('Invalid login delivery receipt');setPending(null);await client.invalidateQueries({predicate:q=>q.queryKey.includes('worker-logins')});}catch(e){if(e instanceof ApiError&&(e.status??0)>=400&&(e.status??0)<500)setPending(null);setError(e instanceof ApiError?e.serverMessage??'Token delivery could not be requested.':'Confirmation is pending. Retry to check the same request.');}finally{setBusy(false);lock.current=false;}}
 return <section className={styles.group} aria-label="Claude token">
  <p role="status" className={styles.note}>{query.isError?'Token delivery status is unavailable.':delivery?.status==='applied'?'Installed the Claude token.':delivery?.status==='failed'?'Installation failed. Retry Push Claude token.':delivery?.status==='pending'?receiver?'Claude token queued. Waiting for the worker to install it when idle.':hasReceiver?'Claude token queued. Waiting for this worker to reconnect.':'Claude token queued. Waiting for the worker’s login receiver.':receiver?'Ready to receive AQ’s saved Claude token.':hasReceiver?'Token delivery will resume when this worker reconnects.':'This worker needs the latest installer to receive the Claude token.'}</p>
  <p className={styles.note}>Codex needs nothing here. Each Codex agent borrows AQ’s saved Codex login when it starts and returns a refreshed one, so no copy on a worker goes out of date.</p>
  <div className={styles.actions}><ActionButton onClick={()=>void push()} disabled={busy}>{busy?'Sending…':pending?'Retry push':'Push Claude token'}</ActionButton></div>
  {!hasReceiver&&install&&<details className={styles.more}><summary>Update this worker</summary><p className={styles.note}>Run this once in this machine’s WSL terminal. Its existing enrollment is kept.</p><code className={styles.command}>{install}</code><ActionButton onClick={()=>{void navigator.clipboard.writeText(install).then(()=>setError('Install command copied.'),()=>setError('Copy the install command above.'));}}>Copy install command</ActionButton></details>}
  {error&&<p role="status" className={styles.note}>{error}</p>}
 </section>;
}
