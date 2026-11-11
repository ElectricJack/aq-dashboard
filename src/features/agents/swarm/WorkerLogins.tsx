import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {apiGet,apiSend,ApiError} from '../../../api/client';
import {isRecord,ContractError} from '../../../api/adapters/contract';
import {useSession,PANEL_READ} from '../../../app/session';
import {queryKey} from '../../../api/queryKeys';
import {ActionButton} from '../../../components/layout/Workspace';
import {hostedWorkerCommand} from './AddMachine';
import styles from './Swarm.module.css';
type Delivery={node_id:string;generation:string|null;providers:string[];status:'waiting'|'pending'|'applied'|'failed';receiver_seen_at_ms:number|null};
function valid(raw:unknown):raw is Delivery{return isRecord(raw)&&typeof raw.node_id==='string'&&(raw.generation===null||typeof raw.generation==='string')&&Array.isArray(raw.providers)&&raw.providers.every(p=>p==='anthropic'||p==='openai')&&['waiting','pending','applied','failed'].includes(String(raw.status))&&(raw.receiver_seen_at_ms===null||typeof raw.receiver_seen_at_ms==='number');}
export function WorkerLogins({nodeId}:{nodeId:string}){
 const {bootstrap,queryContext}=useSession();const client=useQueryClient();const [claude,setClaude]=useState(true),[codex,setCodex]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[pending,setPending]=useState<{operation_id:string;providers:string[]}|null>(null);const lock=useRef(false);
 const allowed=bootstrap.capability('swarm.worker.control').enabled;
 const query=useQuery({queryKey:queryKey(queryContext,'worker-logins',{}),queryFn:async({signal})=>{const raw=await apiGet<unknown>('/api/worker-logins',signal);if(!isRecord(raw)||!Array.isArray(raw.deliveries)||!raw.deliveries.every(valid)||typeof raw.server_time_ms!=='number')throw new ContractError('Invalid login delivery status');return raw as {deliveries:Delivery[];server_time_ms:number};},enabled:allowed,refetchInterval:5000,retry:false,meta:PANEL_READ});
 if(!allowed)return null;
 const delivery=query.data?.deliveries.find(d=>d.node_id===nodeId);
 const receiver=delivery?.receiver_seen_at_ms!==null&&delivery?.receiver_seen_at_ms!==undefined&&!!query.data&&query.data.server_time_ms-delivery.receiver_seen_at_ms<45000;
 const install=hostedWorkerCommand(import.meta.env.VITE_AQ_WORKER_INSTALL_URL,import.meta.env.VITE_AQ_WORKER_INSTALL_SHA256);
 async function push(){if(lock.current||!claude&&!codex)return;lock.current=true;setBusy(true);setError(null);const request=pending??{operation_id:crypto.randomUUID(),providers:[...(claude?['anthropic']:[]),...(codex?['openai']:[])]};setPending(request);try{const receipt=await apiSend<unknown>('POST',`/api/worker-logins/${encodeURIComponent(nodeId)}`,request);if(!isRecord(receipt)||receipt.generation!==request.operation_id)throw new ContractError('Invalid login delivery receipt');setPending(null);await client.invalidateQueries({predicate:q=>q.queryKey.includes('worker-logins')});}catch(e){if(e instanceof ApiError&&(e.status??0)>=400&&(e.status??0)<500)setPending(null);setError(e instanceof ApiError?e.serverMessage??'Login delivery could not be requested.':'Confirmation is pending. Retry to check the same request.');}finally{setBusy(false);lock.current=false;}}
 return <section className={styles.launch} aria-label="Worker logins">
  <div className={styles.actions}><span>Server logins</span><label><input type="checkbox" checked={claude} disabled={busy||!!pending} onChange={e=>setClaude(e.target.checked)}/>Claude</label><label><input type="checkbox" checked={codex} disabled={busy||!!pending} onChange={e=>setCodex(e.target.checked)}/>Codex</label><ActionButton onClick={()=>void push()} disabled={busy||!claude&&!codex}>{busy?'Sending…':pending?'Retry push':'Push logins'}</ActionButton></div>
  <p role="status" className={styles.actionNote}>{query.isError?'Login delivery status is unavailable.':delivery?.status==='applied'?`Installed ${delivery.providers.map(p=>p==='openai'?'Codex':'Claude').join(' and ')} logins.`:delivery?.status==='failed'?'Installation failed. Retry Push logins.':delivery?.status==='pending'?receiver?'Logins queued. Waiting for the worker to install them when idle.':'Logins queued. Waiting for the worker’s login receiver.':receiver?'Ready to receive AQ’s saved subscription logins.':'This worker needs the latest installer to receive server logins.'}</p>
  {!receiver&&install&&<details><summary>Update this worker</summary><p className={styles.actionNote}>Run this once in this machine’s WSL terminal. Its existing enrollment is kept.</p><code className={styles.loginCommand}>{install}</code><ActionButton onClick={()=>{void navigator.clipboard.writeText(install).then(()=>setError('Install command copied.'),()=>setError('Copy the install command above.'));}}>Copy install command</ActionButton></details>}
  {error&&<p role="status" className={styles.actionNote}>{error}</p>}
 </section>;
}
