import {createContext,useContext,useEffect,useRef,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router';
import {apiGet,apiSend,ApiError} from '../../../api/client';
import {isRecord,ContractError} from '../../../api/adapters/contract';
import {validGraphId} from '../../../api/adapters/humanGraph';
import type {SwarmView} from '../../../api/adapters/swarm';
import {useDraft} from '../../../app/useDraft';
import {useSession,PANEL_READ} from '../../../app/session';
export type ManualAgent={id:string;node_id:string;project_id:string;spec:{project_name:string;repository_id:string;provider:string;model:string};status:'pending'|'preparing'|'running'|'stopping'|'stopped'|'failed';stage:string;desired_running:boolean;created_at_ms:number;updated_at_ms:number;worker_seen_at_ms:number|null;uncertain?:boolean};
export type ManualFleet={sessions:ManualAgent[];workers:{node_id:string;max_slots:number;repositories:string[];observed_at_ms:number}[];slots:{node_id:string;project_id:string;slots:number;revision:number}[];projects:{id:string;name:string;repository_id:string}[];server_time_ms:number};
const states=['pending','preparing','running','stopping','stopped','failed'];
export function manualAgent(v:unknown):v is ManualAgent{return isRecord(v)&&validGraphId(v.id)&&validGraphId(v.node_id)&&validGraphId(v.project_id)&&isRecord(v.spec)&&typeof v.spec.project_name==='string'&&v.spec.project_name.length<=512&&validGraphId(v.spec.repository_id)&&typeof v.spec.provider==='string'&&typeof v.spec.model==='string'&&states.includes(String(v.status))&&typeof v.stage==='string'&&v.stage.length<=256&&typeof v.desired_running==='boolean'&&Number.isSafeInteger(v.created_at_ms)&&Number.isSafeInteger(v.updated_at_ms)&&(v.worker_seen_at_ms===null||Number.isSafeInteger(v.worker_seen_at_ms));}
export function adaptManualFleet(raw:unknown):ManualFleet {
 if(!isRecord(raw)||!Array.isArray(raw.sessions)||raw.sessions.length>256||!raw.sessions.every(manualAgent)||!Array.isArray(raw.workers)||!Array.isArray(raw.slots)||!Array.isArray(raw.projects)||!Number.isSafeInteger(raw.server_time_ms))throw new ContractError('Invalid interactive agents');
 if(!raw.workers.every(w=>isRecord(w)&&validGraphId(w.node_id)&&Number.isInteger(w.max_slots)&&Number(w.max_slots)>=1&&Number(w.max_slots)<=8&&Array.isArray(w.repositories)&&w.repositories.length<=16&&w.repositories.every(validGraphId)&&Number.isSafeInteger(w.observed_at_ms))||!raw.slots.every(s=>isRecord(s)&&validGraphId(s.node_id)&&validGraphId(s.project_id)&&Number.isInteger(s.slots)&&Number(s.slots)>=0&&Number(s.slots)<=8&&Number.isSafeInteger(s.revision)&&Number(s.revision)>0)||!raw.projects.every(p=>isRecord(p)&&validGraphId(p.id)&&validGraphId(p.repository_id)&&typeof p.name==='string'))throw new ContractError('Invalid interactive capacity');
 return raw as ManualFleet;
}
type Value={fleet:ManualFleet|undefined;project:string|null;error:unknown;launch:(node:string,project:string,id?:string)=>Promise<string>;stop:(id:string)=>Promise<void>;setSlots:(node:string,project:string,slots:number)=>Promise<void>};
const Context=createContext<Value|null>(null);
export function ManualAgentsProvider({children}:{children:ReactNode}){
 const {queryContext,bootstrap}=useSession();const queryClient=useQueryClient();const [params]=useSearchParams();const rawScope=params.get('scope');const project=rawScope?.startsWith('project:')?rawScope.slice(8):null;
 const key=['manual-agents',queryContext.principalId,queryContext.authorizationRevision,project];
 const query=useQuery({queryKey:key,queryFn:async({signal})=>adaptManualFleet(await apiGet(`/api/manual-agents${project?`?project_id=${project}`:''}`,signal)),enabled:bootstrap.capability('tasks.create').enabled,refetchInterval:1000,refetchOnWindowFocus:true,retry:false,meta:PANEL_READ});
 const [drafts,setDrafts]=useDraft<ManualAgent[]>('manual-agent-launches',[],(v):v is ManualAgent[]=>Array.isArray(v)&&v.length<=32&&v.every(manualAgent));
 const draftRef=useRef(drafts);draftRef.current=drafts;
 const save=(v:ManualAgent[])=>{draftRef.current=v;setDrafts(v);};
 useEffect(()=>{if(query.data&&drafts.some(d=>query.data.sessions.some(s=>s.id===d.id)))setDrafts(drafts.filter(d=>!query.data.sessions.some(s=>s.id===d.id)));},[query.data,drafts,setDrafts]);
 const fleet=query.data?{...query.data,sessions:[...query.data.sessions,...drafts.filter(d=>(!project||d.project_id===project)&&!query.data.sessions.some(s=>s.id===d.id))]}:undefined;
 async function launch(node:string,p:string,id:string=crypto.randomUUID()){
  const item=query.data?.projects.find(v=>v.id===p);if(!item)throw Error('Select a started project');
  if(!draftRef.current.some(v=>v.id===id))save([...draftRef.current,{id,node_id:node,project_id:p,spec:{project_name:item.name,repository_id:item.repository_id,provider:'',model:''},status:'pending',stage:'Requesting agent startup',desired_running:true,created_at_ms:Date.now(),updated_at_ms:Date.now(),worker_seen_at_ms:null}]);
  try {const result=await apiSend<unknown>('POST',`/api/manual-agents/workers/${node}/projects/${p}`,{operation_id:id});if(!manualAgent(result)||result.id!==id||result.node_id!==node||result.project_id!==p)throw new ContractError('Invalid launch receipt');save(draftRef.current.map(v=>v.id===id?result:v));await queryClient.invalidateQueries({queryKey:['manual-agents']});}
  catch(e){const refused=e instanceof ApiError&&[400,403,404,409,422].includes(e.status??0);save(draftRef.current.map(v=>v.id===id?{...v,status:refused?'failed':'pending',stage:refused?(e.serverMessage??'Launch refused'):'Launch confirmation pending',uncertain:!refused}:v));throw e;}
  return id;
 }
 async function stop(id:string){await apiSend('POST',`/api/manual-agents/${id}/stop`,{operation_id:crypto.randomUUID()});await queryClient.invalidateQueries({queryKey:['manual-agents']});}
 async function setSlots(node:string,p:string,slots:number){const old=query.data?.slots.find(v=>v.node_id===node&&v.project_id===p);await apiSend('POST',`/api/manual-agents/workers/${node}/projects/${p}/slots`,{operation_id:crypto.randomUUID(),expected_revision:old?.revision??0,slots});await queryClient.invalidateQueries({queryKey:['manual-agents']});}
 return <Context value={{fleet,project,error:query.error,launch,stop,setSlots}}>{children}</Context>;
}
export const useManualAgents=()=>useContext(Context);
export function capacity(fleet:ManualFleet,node:string,project:string){const p=fleet.projects.find(p=>p.id===project),w=fleet.workers.find(w=>w.node_id===node);if(!p||!w||!w.repositories.includes(p.repository_id))return 0;return Math.min(w.max_slots,fleet.slots.find(s=>s.node_id===node&&s.project_id===project)?.slots??1);}
export function mergeManual(view:SwarmView,fleet:ManualFleet|undefined,project:string|null,selected:string|null):SwarmView {
 if(!fleet)return view;
 return {...view,machines:view.machines.map(m=>({...m,nodes:m.nodes.map(n=>{
  const report=fleet.workers.find(w=>w.node_id===n.id);if(!report)return n;
  const manual=fleet.sessions.filter(s=>s.node_id===n.id&&(!project||s.project_id===project)&&(!['stopped','failed'].includes(s.status)||selected===`agent:${s.id}`));
  const running=manual.filter(s=>!['pending','stopped','failed'].includes(s.status)).length;
  const total=project?capacity(fleet,n.id,project):Math.min(report.max_slots,fleet.projects.reduce((sum,p)=>sum+capacity(fleet,n.id,p.id),0));
  const occupied=n.agents.length+running;
  const allManual=fleet.sessions.filter(s=>s.node_id===n.id&&['preparing','running','stopping'].includes(s.status)).length;
  const elsewhere=Math.max(0,allManual-running);
  const idle=Math.min(Math.max(0,total-occupied),Math.max(0,report.max_slots-occupied-elsewhere));
  return {...n,backendKind:n.backendKind??'docker-local',slots:{total:Math.max(total,occupied),occupied,idle,...(total<occupied?{target:total}:{})},agents:[...n.agents,...manual.map(s=>({sessionId:s.id,attemptId:s.id,task:null,project:{id:s.project_id,label:s.spec.project_name},provider:s.spec.provider||null,model:s.spec.model||null,harness:'claude',intelligenceClass:null,terminalId:s.status==='running'?s.id:null,startedAt:new Date(s.created_at_ms).toISOString(),manual:s}))]};
 })}))};
}
