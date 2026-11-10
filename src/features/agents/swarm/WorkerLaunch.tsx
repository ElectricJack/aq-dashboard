import {useRef,useState} from 'react';
import {useSearchParams,Link} from 'react-router';
import {ActionButton} from '../../../components/layout/Workspace';
import type {NodeView} from '../../../api/adapters/swarm';
import {useManualAgents,capacity} from './manualAgents';
import styles from './Swarm.module.css';
export function WorkerLaunch({node}:{node:NodeView}){
 const manual=useManualAgents();const [,setParams]=useSearchParams();const [selected,setSelected]=useState('');const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);const lock=useRef(false);
 if(!manual)return null;
 const fleet=manual.fleet,worker=fleet?.workers.find(w=>w.node_id===node.id);
 const choices=fleet?.projects.filter(p=>worker?.repositories.includes(p.repository_id))??[];
 const project=manual.project??selected??choices[0]?.id;
 const chosen=choices.find(p=>p.id===project)??(manual.project?undefined:choices[0]);
 const slots=chosen&&fleet?capacity(fleet,node.id,chosen.id):0;
 const available=!!worker&&!!fleet&&fleet.server_time_ms-worker.observed_at_ms<15000&&node.health==='online';
 async function launch(){if(!manual||!chosen||lock.current)return;lock.current=true;setBusy(true);setError(null);const id=crypto.randomUUID();
  setParams(previous=>{const p=new URLSearchParams(previous);p.set('select',`agent:${id}`);return p;},{replace:true});
  try{await manual.launch(node.id,chosen.id,id);}catch(e){setError(e instanceof Error?e.message:'Launch could not be confirmed');}finally{lock.current=false;setBusy(false);}
 }
 async function change(delta:number){if(!manual||!chosen||lock.current)return;lock.current=true;setBusy(true);setError(null);try{await manual.setSlots(node.id,chosen.id,slots+delta);}catch(e){setError(e instanceof Error?e.message:'Slot change could not be confirmed');}finally{lock.current=false;setBusy(false);}}
 return <section className={styles.launch} aria-label="Interactive agents">
  <label>Project<select aria-label="Agent project" value={chosen?.id??''} onChange={e=>{setSelected(e.target.value);setParams(previous=>{const p=new URLSearchParams(previous);p.set('scope',`project:${e.target.value}`);return p;},{replace:true});}} disabled={busy||!!manual.project}>
   {choices.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select></label>
  <div className={styles.actions}><ActionButton onClick={()=>void launch()} disabled={busy||!available||!chosen}>{busy?'Starting…':'Launch agent'}</ActionButton></div>
  <p className={styles.actionNote}>Starts an interactive agent. Connect in the graph and work with it until you stop it.</p>
  {chosen&&<><div className={styles.actions} aria-label="Project worker slots"><ActionButton aria-label="Remove project slot" onClick={()=>void change(-1)} disabled={busy||!available||slots===0}>−</ActionButton><span>{slots} project slot{slots===1?'':'s'}</span><ActionButton aria-label="Add project slot" onClick={()=>void change(1)} disabled={busy||!available||slots>=(worker?.max_slots??0)}>+</ActionButton></div><p className={styles.actionNote}>Removing a busy slot lets its agent continue until stopped.</p></>}
  {!available&&<p role="status" className={styles.actionNote}>Waiting for this worker's interactive capacity report.</p>}
  {!chosen&&fleet&&<p className={styles.actionNote}>No started project is configured on this worker. <Link to="/settings?tab=projects">Manage projects</Link></p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
