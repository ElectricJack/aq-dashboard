import {useState} from 'react';
import {Link,useParams} from 'react-router';
import {useQuery} from '@tanstack/react-query';
import {apiGet,apiSend,ApiError} from '../../../api/client';
import {isRecord,ContractError} from '../../../api/adapters/contract';
import {queryKey} from '../../../api/queryKeys';
import {useSession,PANEL_READ} from '../../../app/session';
import {DestinationPage} from '../../../app/DestinationPage';
import {ActionButton} from '../../../components/layout/Workspace';
import {InteractiveTerminal} from '../InteractiveTerminal';
import {HostTerminalAction} from './HostTerminalAction';
import styles from './HostTerminal.module.css';
type Host={ready:boolean;node_name:string;shell:{id:string;status:'starting'|'running'|'ended';desired_running:boolean}|null};
function adapt(raw:unknown):Host {
 if(!isRecord(raw)||typeof raw.ready!=='boolean'||typeof raw.node_name!=='string'||!(raw.shell===null||isRecord(raw.shell)&&typeof raw.shell.id==='string'&&['starting','running','ended'].includes(String(raw.shell.status))&&typeof raw.shell.desired_running==='boolean'))throw new ContractError('Invalid host terminal');
 return raw as Host;
}
function HostTerminal(){
 const {nodeId=''}=useParams();const {queryContext}=useSession();
 const [stopping,setStopping]=useState(false),[error,setError]=useState<string|null>(null);
 const query=useQuery({queryKey:queryKey(queryContext,'worker-host-terminal',{nodeId}),queryFn:async({signal})=>adapt(await apiGet(`/api/worker-terminals/${encodeURIComponent(nodeId)}`,signal)),refetchInterval:2000,retry:false,meta:PANEL_READ});
 const data=query.isError?undefined:query.data,shell=data?.shell;
 async function stop(){if(!shell||stopping)return;setStopping(true);setError(null);try{await apiSend('POST',`/api/worker-terminals/shells/${shell.id}/stop`,{operation_id:crypto.randomUUID()});await query.refetch();}catch(e){setError(e instanceof ApiError?e.serverMessage??'Shell could not be ended.':'Shell confirmation is pending. Retry End shell.');}finally{setStopping(false);}}
 return <section className={styles.workspace} data-terminal-workspace data-has-panes={shell?.status==='running'||undefined}>
  <header className={styles.header}><Link to="/agents/swarm">← Swarm</Link><h1>{data?.node_name??'Worker'} terminal</h1>{shell?.desired_running?<ActionButton disabled={stopping} onClick={()=>void stop()}>{stopping?'Ending…':'End shell'}</ActionButton>:<HostTerminalAction nodeId={nodeId} onOpened={()=>{void query.refetch();}}/>}</header>
  <p className={styles.note}>Linux / WSL host · service user · Closing this view leaves the shell running.</p>
  {error&&<p role="status">{error}</p>}
  {query.isError?<p role="status">Host terminal access is unavailable.</p>:!data?<p role="status">Loading worker…</p>:!data.ready?<p role="status">Host terminal is offline. Update this worker’s controls in Swarm.</p>:shell?.status==='running'?<InteractiveTerminal terminalId={shell.id} name={data.node_name} hostShell inputEnabled={shell.desired_running} label="Worker host terminal"/>:<p role="status">{shell?.desired_running?'Starting host shell…':'Shell ended. Open terminal to start a new shell.'}</p>}
 </section>;
}
export function Component(){const {queryContext:c}=useSession();return <DestinationPage id="agents"><HostTerminal key={`${c.principalId}:${c.authorizationRevision}`} /></DestinationPage>;}
