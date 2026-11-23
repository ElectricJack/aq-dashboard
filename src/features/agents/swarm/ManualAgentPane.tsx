import {useState} from 'react';
import {useSearchParams} from 'react-router';
import type {AgentView} from '../../../api/adapters/swarm';
import {ActionButton} from '../../../components/layout/Workspace';
import {InteractiveTerminal} from '../InteractiveTerminal';
import {useManualAgents} from './manualAgents';
import styles from './Swarm.module.css';
function startupMessage(agent: NonNullable<AgentView["manual"]>) {
 if (agent.status === 'pending' || agent.status === 'preparing') return 'Startup continues here. You can select another node while it prepares.';
 if (agent.status === 'stopped') return 'This agent has stopped. Its workspace remains on the worker.';
 return agent.stage;
}
function ManualIdentity({ m }: { m: NonNullable<AgentView["manual"]> }) {
 return <div className={styles.manualIdentity}><h2 tabIndex={-1}>{m.spec.project_name}</h2>{m.spec.model&&<span>{m.spec.model}{m.spec.reasoning?` · ${m.spec.reasoning}`:""}</span>}<span role="status">{m.stage}</span></div>;
}
function useManualAction(manual: ReturnType<typeof useManualAgents>) {
 const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
 async function run(action: (service: NonNullable<typeof manual>) => Promise<unknown>, failure: string) {
  if (!manual || busy) return;
  setBusy(true); setError(null);
  try { await action(manual); } catch { setError(failure); } finally { setBusy(false); }
 }
 return { busy, error, run };
}

function focusSearch(current: URLSearchParams, focused: boolean) {
 const next = new URLSearchParams(current);
 if (focused) next.delete('focus'); else next.set('focus', 'terminal');
 return next;
}

export function ManualAgentPane({agent}:{agent:AgentView}){
 const m=agent.manual!,manual=useManualAgents();const [params,setParams]=useSearchParams();const focused=params.get('focus')==='terminal';
 const { busy, error, run } = useManualAction(manual);
 const stop = () => run(service => service.stop(m.id), 'Stop could not be confirmed. Retry to check the same agent.');
 const retry = () => run(service => service.launch({ node: m.node_id, project: m.project_id, id: m.id, intelligence: m.spec.intelligence_profile }), 'Launch is still awaiting confirmation.');
 return <><header className={styles.manualHead}><ManualIdentity m={m} />
 <div className={styles.manualActions}>{(focused||m.status==='running')&&<ActionButton onClick={()=>setParams(p => focusSearch(p, focused),{replace:true})}>{focused?'Back to graph':'Expand terminal'}</ActionButton>}{m.uncertain?<ActionButton disabled={busy} onClick={()=>void retry()}>Retry same launch</ActionButton>:!['stopped','failed'].includes(m.status)&&<ActionButton disabled={busy||m.status==='stopping'} onClick={()=>void stop()}>{m.status==='stopping'?'Stopping…':'Stop agent'}</ActionButton>}</div>
</header>
 {error&&<p role="alert">{error}</p>}
 {m.status==='running'?<div className={styles.terminal}><InteractiveTerminal key={m.id} terminalId={m.id} manual name={`${m.spec.project_name} · ${m.spec.model}`} label="Agent terminal"/></div>:<p className={styles.actionNote}>{startupMessage(m)}</p>}
 </>;
}
