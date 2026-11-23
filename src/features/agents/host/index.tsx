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
function validShell(raw: unknown) {
  if (raw === null) return true;
  if (!isRecord(raw) || typeof raw.id !== 'string') return false;
  return ['starting', 'running', 'ended'].includes(String(raw.status)) && typeof raw.desired_running === 'boolean';
}
function adapt(raw: unknown): Host {
  if (isRecord(raw) && typeof raw.ready === 'boolean') {
    if (typeof raw.node_name === 'string' && validShell(raw.shell)) return raw as Host;
  }
  throw new ContractError('Invalid host terminal');
}
async function stopHostShell(shellId: string) {
  await apiSend('POST', `/api/worker-terminals/shells/${shellId}/stop`, { operation_id: crypto.randomUUID() });
}

function stopFailure(error: unknown) {
  if (error instanceof ApiError) return error.serverMessage ?? 'Shell could not be ended.';
  return 'Shell confirmation is pending. Retry End shell.';
}

function useHostTerminal(nodeId: string) {
  const { queryContext } = useSession();
  return useQuery({queryKey:queryKey(queryContext,'worker-host-terminal',{nodeId}),queryFn:async({signal})=>adapt(await apiGet(`/api/worker-terminals/${encodeURIComponent(nodeId)}`,signal)),refetchInterval:2000,retry:false,meta:PANEL_READ});
}

function useStopHostShell(shell: Host['shell'] | undefined, refresh: () => Promise<unknown>) {
 const [stopping,setStopping]=useState(false),[error,setError]=useState<string|null>(null);
 async function stop() {
   if (!shell || stopping) return;
   setStopping(true);
   setError(null);
   try {
     await stopHostShell(shell.id);
     await refresh();
   } catch (error) { setError(stopFailure(error)); }
   finally { setStopping(false); }
 }
 return { stopping, error, stop };
}

function HostTerminal(){
 const {nodeId=''}=useParams();
 const query = useHostTerminal(nodeId);
 const data=query.isError?undefined:query.data,shell=data?.shell;
 const { stopping, error, stop } = useStopHostShell(shell, query.refetch);
 return <section className={styles.workspace} data-terminal-workspace data-has-panes={shell?.status==='running'||undefined}>
  <HostHeader data={data} nodeId={nodeId} stopping={stopping} stop={() => void stop()} refresh={() => void query.refetch()} />
  <p className={styles.note}>Linux / WSL host · service user · Closing this view leaves the shell running.</p>
  {error&&<p role="status">{error}</p>}
  <HostShell data={data} failed={query.isError} />
 </section>;
}
export function Component(){const {queryContext:c}=useSession();return <DestinationPage id="agents"><HostTerminal key={`${c.principalId}:${c.authorizationRevision}`} /></DestinationPage>;}

function HostShell({ data, failed }: { data: Host | undefined; failed: boolean }) {
  if (failed) return <p role="status">Host terminal access is unavailable.</p>;
  if (!data) return <p role="status">Loading worker…</p>;
  if (!data.ready) return <p role="status">Host terminal is offline. Update this worker’s controls in Swarm.</p>;
  const shell = data.shell;
  if (shell?.status === 'running') return <InteractiveTerminal terminalId={shell.id} name={data.node_name} hostShell inputEnabled={shell.desired_running} label="Worker host terminal"/>;
  return <p role="status">{shell?.desired_running ? 'Starting host shell…' : 'Shell ended. Open terminal to start a new shell.'}</p>;
}

function HostHeader({ data, nodeId, stopping, stop, refresh }: { data?: Host; nodeId: string; stopping: boolean; stop(): void; refresh(): void }) {
  return <header className={styles.header}><Link to="/agents/swarm">← Swarm</Link><h1>{data?.node_name??'Worker'} terminal</h1>{data?.shell?.desired_running?<ActionButton disabled={stopping} onClick={stop}>{stopping?'Ending…':'End shell'}</ActionButton>:<HostTerminalAction nodeId={nodeId} onOpened={refresh}/>}</header>;
}
