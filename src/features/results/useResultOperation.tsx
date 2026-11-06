import {useEffect,useRef,useState} from "react";
import {useQueryClient,type InfiniteData} from "@tanstack/react-query";
import type {ResultsPage} from "../../api/wire/resultsFeedback";
import {apiGet,apiSend,ApiError} from "../../api/client";
import {adaptResultOperation,type ResultOperation} from "../../api/adapters/resultsFeedback";
import {useSession} from "../../app/session";
import {ActionButton} from "../../components/layout/Workspace";
type Intent={id:string;method:"POST"|"PUT";path:string;body:unknown;recoveryPath?:string};
/** A frozen request owns one operation key until an explicit terminal reset. */
export function useResultOperation(project:string,capability:string,initial?:{id:string;recoveryPath?:string}){
 const client=useQueryClient(),session=useSession(),active=useRef(true),generation=useRef(0),lock=useRef(false),intent=useRef<Intent|null>(initial?{id:initial.id,method:"POST",path:"",body:{},recoveryPath:initial.recoveryPath}:null),request=useRef<AbortController|null>(null);
 const [status,setStatus]=useState<ResultOperation|null>(null),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[refused,setRefused]=useState<string|null>(null),[id,setId]=useState<string|null>(initial?.id??null);
 const enabled=session.bootstrap.capability(capability).enabled;
 useEffect(()=>{active.current=true;lock.current=false;setBusy(false);return()=>{active.current=false;generation.current++;request.current?.abort();request.current=null;};},[enabled]);
 async function execute(kind:"submit"|"lookup"|"recover",value:Intent){
  if(lock.current||!active.current||kind!=="lookup"&&!enabled)return;const ticket=generation.current;lock.current=true;setBusy(true);setUnknown(false);setRefused(null);const controller=new AbortController();request.current=controller;
  try {
   const raw=kind==="lookup"?await apiGet<unknown>(`/api/v1/operations/${value.id}`,controller.signal):await apiSend<unknown>(kind==="submit"?value.method:"POST",kind==="submit"?value.path:value.recoveryPath!,kind==="submit"?value.body:{},controller.signal);
   const op=adaptResultOperation(raw,value.id,project);
   if(!active.current||ticket!==generation.current)return;
   if(status?.operation_id===value.id&&status.request_digest!==op.request_digest)throw new Error("Operation identity changed");
   setStatus(op);
   if(op.disposition==="confirmed")for(const entity of op.affected_entities){if(entity.type!=="result"||!entity.revision||!/^[1-9][0-9]*$/.test(entity.revision))continue;
    client.setQueriesData<InfiniteData<ResultsPage>>({predicate:q=>q.queryKey[0]==="aq"&&q.queryKey[1]===session.queryContext.principalId&&q.queryKey[2]===session.queryContext.authorizationRevision&&q.queryKey[4]==="result-feed"},old=>old?{...old,pages:old.pages.map(page=>({...page,items:page.items.map(item=>item.result.id===entity.id&&BigInt(item.result.version)<BigInt(entity.revision!)?{...item,result:{...item.result,version:entity.revision!}}:item)}))}:old);
   }
   return op;
  }catch(error){if(active.current&&ticket===generation.current){if(error instanceof ApiError&&error.status===403){session.reportAccessDenied(error);setRefused(error.serverMessage??"");return;}if(error instanceof ApiError&&error.status===401)session.reportAccessDenied(error);else if(error instanceof ApiError&&error.status===426)session.reportIncompatible(capability);setUnknown(true);}}
  finally{if(active.current&&ticket===generation.current)setBusy(false);if(request.current===controller){lock.current=false;request.current=null;}}
 }
 async function submit(method:Intent["method"],path:string,body:Record<string,unknown>,recoveryPath?:string){
  if(!enabled||!active.current||intent.current||lock.current)return;const value={id:String(body.operation_id),method,path,body:structuredClone(body),recoveryPath};intent.current=value;setId(value.id);setStatus(null);return execute("submit",value);
 }
 // A refused request (403) was never applied, so it settles like a rejection and the draft can be revised.
 const terminal=refused!==null||!!status&&["confirmed","conflict","rejected"].includes(status.disposition);
 return {id,status,busy,unknown,refused,terminal,submit,lookup:()=>intent.current?execute("lookup",intent.current):undefined,recover:()=>intent.current?.recoveryPath&&(!status||status.recovery==="lookup_original")?execute("recover",intent.current):undefined,reset:()=>{if(!terminal||lock.current)return;intent.current=null;setId(null);setStatus(null);setUnknown(false);setRefused(null);}};
}
export type ResultOperationControl=ReturnType<typeof useResultOperation>;
export function OperationStatus({operation,recover,onCheck,onRevise}:{operation:ResultOperationControl;recover?:boolean;onCheck?:(value:ResultOperation)=>void;onRevise?:()=>Promise<void>}){
 const [refreshing,setRefreshing]=useState(false);
 if(!operation.id)return null;
 return <section aria-label="Operation status"><p role="status">{operation.busy?"Checking operation…":operation.refused!==null?`AQ refused this request.${operation.refused?` ${operation.refused}.`:""} Your draft is preserved.`:operation.unknown?"Operation outcome is unknown. Check its status before another submission.":`Operation ${operation.status?.disposition??"unknown"}.`}</p><div className="result-actions"><ActionButton disabled={operation.busy} onClick={()=>{void operation.lookup()?.then(value=>{if(value)onCheck?.(value);});}}>Check status</ActionButton>{recover&&!operation.terminal&&(!operation.status||operation.status.recovery==="lookup_original")&&<ActionButton disabled={operation.busy} onClick={()=>{void operation.recover()?.then(value=>{if(value)onCheck?.(value);});}}>Recover original request</ActionButton>}{operation.terminal&&operation.status?.disposition!=="confirmed"&&<ActionButton disabled={operation.busy||refreshing} onClick={()=>{setRefreshing(true);void Promise.resolve(onRevise?.()).then(()=>operation.reset()).catch(()=>{}).finally(()=>setRefreshing(false));}}>Revise draft</ActionButton>}</div><details><summary>Operation reference</summary><p>{operation.id}</p></details></section>;
}
