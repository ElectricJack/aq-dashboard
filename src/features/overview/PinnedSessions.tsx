import { useState } from 'react';
import { Link } from 'react-router';
import { Pin, Monitor } from 'lucide-react';
import { adaptPage, adaptSession, type SessionView } from '../../api/adapters/inspection';
import type { Page, SessionSummary } from '../../api/wire/proposed';
import { useSession } from '../../app/session';
import { useScope, scopeSearch } from '../../app/scope';
import { useRead } from '../../app/useRead';
import { Icon } from '../../components/icons';
import { QueryStatus } from '../../components/QueryStatus/QueryStatus';
import styles from './Overview.module.css';

/** Explicit visit-local selection. API roster membership never implies a pin or live process. */
export function PinnedSessions() {
 const [scope]=useScope();const {bootstrap}=useSession();const capability=bootstrap.capability('sessions.read');
 const [pins,setPins]=useState<string[]>([]);const [choice,setChoice]=useState('');
 const query=useRead<Page<SessionSummary>,SessionView[]>({resource:'overview-session-snapshots',path:'/api/v1/sessions',scope,params:{limit:4},enabled:capability.enabled,adapt:(p,clock)=>adaptPage(p,item=>adaptSession(item,clock)).items,pollMs:15000});
 const available=query.data?.view??[];
 return <section className={styles.panel} aria-labelledby="overview-sessions-heading">
  <div className={styles.panelHeading}><h2 id="overview-sessions-heading">Pinned sessions</h2><Icon icon={Pin}/></div>
  {!capability.enabled?<p className={styles.meta}>{capability.reason}</p>:!query.data||query.isError?<QueryStatus status={query.isError?'error':'pending'} error={query.error} label="session snapshots" onRetry={()=>void query.refetch()}/>:<>
   {pins.length===0?<p className={styles.meta}>No pinned sessions. Choose a session for this visit.</p>:<ul className={styles.snapshotList}>{pins.map(id=>{
    const session=available.find(s=>s.id===id);
    return <li key={id} className={styles.sessionRow}>{session?<>
      <div><strong><Icon icon={Monitor} size={16}/> {session.label}</strong><span className={styles.meta}>{session.wait?.explanation ?? (session.observation.state==='reported_running'?'Running (reported)':session.observation.state==='reported_stopped'?'Stopped (reported)':'Process observation unknown')}{session.observation.freshness==='stale'&&' · Stale observation'}</span></div>
      <Link className={styles.action} to={{pathname:`/agents/${encodeURIComponent(id)}`,search:scopeSearch(scope)}} aria-label={`${session.wait?'Open':'Watch'}: ${session.label}`}>{session.wait?'Open':'Watch'} →</Link>
    </>:<span className={styles.meta}>Pinned session is outside the current snapshot. Open Agents to inspect.</span>}
    <button className={styles.pinButton} onClick={()=>setPins(pins.filter(pin=>pin!==id))} aria-label={`Unpin ${session?.label??'session'}`}>Unpin</button></li>;
   })}</ul>}
   <details className={styles.observationDetails}><summary>Choose sessions</summary>
    {available.length===0?<p className={styles.meta}>No session records in this scope.</p>:<div className={styles.sessionChoice}><label htmlFor="overview-session-choice">Session snapshot</label><select id="overview-session-choice" value={choice} onChange={event=>setChoice(event.target.value)}><option value="">Choose a session</option>{available.filter(s=>!pins.includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select><button className={styles.pinButton} disabled={!choice||pins.includes(choice)} onClick={()=>{setPins([...pins,choice]);setChoice('');}}>Pin session</button><span className={styles.meta}>Showing up to four session records. Pins last for this visit.</span></div>}
   </details>
   <Link to={{pathname:'/agents',search:scopeSearch(scope)}}>All sessions →</Link>
  </>}
 </section>;
}
