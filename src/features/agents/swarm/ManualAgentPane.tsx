import {useState} from 'react';
import {useSearchParams} from 'react-router';
import type {AgentView} from '../../../api/adapters/swarm';
import {ActionButton} from '../../../components/layout/Workspace';
import {InteractiveTerminal} from '../InteractiveTerminal';
import {useManualAgents} from './manualAgents';
import styles from './Swarm.module.css';
export function ManualAgentPane({agent}:{agent:AgentView}){
 const m=agent.manual!,manual=useManualAgents();const [params,setParams]=useSearchParams();const focused=params.get('focus')==='terminal';const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 async function stop(){if(!manual||busy)return;setBusy(true);setError(null);try{await manual.stop(m.id);}catch{setError('Stop could not be confirmed. Retry to check the same agent.');}finally{setBusy(false);}}
 async function retry(){if(!manual||busy)return;setBusy(true);setError(null);try{await manual.launch(m.node_id,m.project_id,m.id,m.spec.intelligence_profile);}catch{setError('Launch is still awaiting confirmation.');}finally{setBusy(false);}}
 return <><header className={styles.manualHead}><div className={styles.manualIdentity}><h2 tabIndex={-1}>{m.spec.project_name}</h2>{m.spec.model&&<span>{m.spec.model}{m.spec.reasoning?` · ${m.spec.reasoning}`:""}</span>}<span role="status">{m.stage}</span></div>
 <div className={styles.manualActions}>{(focused||m.status==='running')&&<ActionButton onClick={()=>setParams(p=>{const n=new URLSearchParams(p);if(focused)n.delete('focus');else n.set('focus','terminal');return n;},{replace:true})}>{focused?'Back to graph':'Expand terminal'}</ActionButton>}{m.uncertain?<ActionButton disabled={busy} onClick={()=>void retry()}>Retry same launch</ActionButton>:!['stopped','failed'].includes(m.status)&&<ActionButton disabled={busy||m.status==='stopping'} onClick={()=>void stop()}>{m.status==='stopping'?'Stopping…':'Stop agent'}</ActionButton>}</div>
</header>
 {error&&<p role="alert">{error}</p>}
 {m.status==='running'?<div className={styles.terminal}><InteractiveTerminal key={m.id} terminalId={m.id} manual name={`${m.spec.project_name} · ${m.spec.model}`} label="Agent terminal"/></div>:<p className={styles.actionNote}>{m.status==='pending'||m.status==='preparing'?'Startup continues here. You can select another node while it prepares.':m.status==='stopped'?'This agent has stopped. Its workspace remains on the worker.':m.stage}</p>}
 </>;
}
