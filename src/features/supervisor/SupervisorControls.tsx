import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router';
import {useSession} from '../../app/session';
import {useDraft} from '../../app/useDraft';
import {ApiError} from '../../api/client';
import {isRecord} from '../../api/adapters/contract';
import {supervisorId} from '../../api/adapters/supervisor';
import {readSupervisors,setSupervisor,inspectSupervisorControl,type SupervisorControl,type SupervisorIntent,type SupervisorFleet} from '../../api/supervisors';
import {ActionButton} from '../../components/layout/Workspace';
import styles from './SupervisorConversation.module.css';
export function validSupervisorScope(v:unknown):v is string{return v==='global'||typeof v==='string'&&v.startsWith('project:')&&supervisorId(v.slice(8));}
export function useSupervisors(enabled:boolean){const {bootstrap,queryContext}=useSession();return useQuery({queryKey:['supervisor-controls',queryContext.principalId,queryContext.authorizationRevision],enabled:enabled&&bootstrap.capability('supervisor.history.read').enabled,queryFn:({signal})=>readSupervisors(signal),refetchInterval:enabled?2000:false,retry:false});}
const validIntent=(v:unknown):v is SupervisorIntent|null=>v===null||isRecord(v)&&supervisorId(v.operation_id)&&Number.isSafeInteger(v.expected_revision)&&typeof v.enabled==='boolean'&&(v.intelligence_profile===undefined||isRecord(v.intelligence_profile));
const labels={idle:'Ready',working:'Working',waiting:'Waiting',stopped:'Stopped',stopping:'Stopping',failed:'Needs attention',uncertain:'Needs inspection',unavailable:'Offline'};
export function SupervisorControls({fleet,selected,scope,onScope,onChanged}:{fleet:SupervisorFleet|undefined;selected:SupervisorControl|undefined;scope:string;onScope:(scope:string)=>void;onChanged:()=>Promise<unknown>}){
 const [mobile,setMobile]=useState(()=>window.innerWidth<768),[expanded,setExpanded]=useState(false);
 useEffect(()=>{const resize=()=>setMobile(window.innerWidth<768);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>{setExpanded(!selected?.enabled);},[scope,selected?.enabled]);
 return <details className={styles.controlDisclosure} open={!mobile||expanded} onToggle={e=>{if(mobile)setExpanded(e.currentTarget.open);}}>
  <summary><span>Supervisor controls</span><span>{selected?labels[selected.phase]:'Unavailable'}</span></summary>
  <div className={styles.management} aria-label="Supervisor controls">
  <label>Supervisor<select aria-label="Supervisor" value={scope} onChange={e=>onScope(e.target.value)}><option value="global">Global supervisor</option>{fleet?.supervisors.filter(s=>s.project_id).map(s=><option key={s.id} value={`project:${s.project_id}`}>{s.label}</option>)}{scope!=='global'&&!selected&&<option value={scope}>Project supervisor unavailable</option>}</select></label>
  {selected&&fleet?<Settings key={selected.id} value={selected} fleet={fleet} onChanged={onChanged}/>:<span role="status">Supervisor controls unavailable</span>}
 </div></details>;
}
function Settings({value:s,fleet,onChanged}:{value:SupervisorControl;fleet:SupervisorFleet;onChanged:()=>Promise<unknown>}){
 const client=useQueryClient();const [profile,setProfile]=useState('');const [pending,setPending]=useDraft<SupervisorIntent|null>(`supervisor-control:${s.id}`,null,validIntent);const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const key=(p:SupervisorFleet['profiles'][number])=>`${p.profile_id}@${p.profile_version}:${p.candidate_id}`;
 const current=fleet.profiles.find(p=>key(p)===profile)??fleet.profiles.find(p=>s.profile&&key(p)===key(s.profile))??fleet.profiles.find(p=>p.profile_id==='supervisor-medium')??fleet.profiles.find(p=>p.profile_id==='standard-medium')??fleet.profiles[0];
 async function submit(intent:SupervisorIntent,inspect=false){if(lock.current)return;lock.current=true;setBusy(true);setError(null);try{if(inspect)await inspectSupervisorControl(s.id,intent);else await setSupervisor(s.id,intent);if(!alive.current)return;setPending(null);await onChanged();await client.invalidateQueries({predicate:q=>q.queryKey.includes('bootstrap')||q.queryKey.includes('supervisor-global')});}catch(e){if(alive.current){if(e instanceof ApiError&&[400,401,403,409,422].includes(e.status??0)){setPending(null);setError(e.serverMessage??'Supervisor settings changed. Refresh and try again.');await onChanged();}else setError(inspect&&e instanceof ApiError&&e.status===404?'No receipt found. Retry the same change.':'Confirmation pending. Check the receipt or retry the same change.');}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 function change(enabled:boolean){if(lock.current||pending||enabled&&!current)return;const intent:SupervisorIntent={operation_id:crypto.randomUUID(),expected_revision:s.revision,enabled,...(enabled&&current?{intelligence_profile:{profile_id:current.profile_id,profile_version:current.profile_version,candidate_id:current.candidate_id}}:{})};setPending(intent);void submit(intent);}
 return <><label>Intelligence<select aria-label="Supervisor intelligence profile" value={current?key(current):''} disabled={busy||!!pending} onChange={e=>setProfile(e.target.value)}>{fleet.profiles.map(p=><option key={key(p)} value={key(p)}>{p.name} · {p.model} · {p.reasoning}</option>)}</select></label>
  {pending?<><ActionButton disabled={busy} onClick={()=>void submit(pending)}>Retry same change</ActionButton><ActionButton disabled={busy} onClick={()=>void submit(pending,true)}>Check change</ActionButton></>:<>{s.enabled?<><ActionButton disabled={busy} onClick={()=>change(false)}>Stop supervisor</ActionButton>{current&&s.profile&&key(current)!==key(s.profile)&&<ActionButton disabled={busy} onClick={()=>change(true)}>Apply profile</ActionButton>}</>:<ActionButton disabled={busy||!current||s.phase==='uncertain'} onClick={()=>change(true)}>Start supervisor</ActionButton>}</>}
  <span role="status" title={s.stage}>{labels[s.phase]}</span>{(s.phase==='failed'||s.phase==='uncertain')&&<span>{s.last_error??s.stage}</span>}
  {!current&&<Link to="/settings?tab=intelligence">Add a Codex intelligence profile</Link>}{error&&<span role="status">{error}</span>}
 </>;
}
