import {useEffect,useId,useLayoutEffect,useRef,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Link,useSearchParams} from "react-router";
import {Plus} from "lucide-react";
import {useSession} from "../../app/session";
import {useDraft} from "../../app/useDraft";
import {isRecord} from "../../api/adapters/contract";
import {useScope,scopeSearch} from "../../app/scope";
import {apiGet,ApiError} from "../../api/client";
import {queryKey} from "../../api/queryKeys";
import {graphPath} from "../../api/humanGraphReads";
import {adaptGraphPage,adaptGraphDetail,validGraphId,type GraphNode} from "../../api/adapters/humanGraph";
import {adaptTaskOperation,freezeTaskCreate,validateTaskDraft,type FrozenTaskCreate,type TaskDraft,type TaskOperation} from "../../api/adapters/taskCreate";
import {taskOperationRequest} from "../../api/taskCreateClient";
import {ActionButton} from "../../components/layout/Workspace";
import styles from "./CreateTask.module.css";
const blank:TaskDraft={title:"",body:"",acceptance_criteria:"",task_state:"draft"};
function validDraft(value:unknown):value is TaskDraft{return isRecord(value)&&typeof value.title==="string"&&value.title.length<=1024&&typeof value.body==="string"&&typeof value.acceptance_criteria==="string"&&(value.task_state==="draft"||value.task_state==="active");}
export function CreateTaskAction(){
 const {bootstrap,queryContext}=useSession();const [scope]=useScope();const capability=bootstrap.capability("tasks.create");
 const identity=`${queryContext.principalId}:${queryContext.authorizationRevision}`;const [revoked,setRevoked]=useState<string|null>(null);
 const project=scope.kind==="project"&&validGraphId(scope.project_id)?scope.project_id:undefined;
 if(revoked===identity)return <div className={styles.action}><p role="alert" className={styles.warning}>Access changed. Reload after signing in to check the operation.</p><ActionButton onClick={()=>window.location.reload()}>Reload access</ActionButton></div>;
 if(!capability.enabled||!project)return <div className={styles.action}><ActionButton disabled title={!capability.enabled?capability.reason:"Choose a project first"}><Plus size={18} aria-hidden/>Create task</ActionButton><span className={styles.hint}>{!capability.enabled?capability.reason:"Choose a project first"}</span></div>;
 return <Composer key={`${identity}:${project}`} project={project} onAccessRevoked={()=>setRevoked(identity)}/>;
}
function Composer({project,onAccessRevoked}:{project:string;onAccessRevoked:()=>void}){
 const {queryContext,reportIncompatible,reportAccessDenied}=useSession();const client=useQueryClient();const [params,setParams]=useSearchParams();const raw=params.get("operation");const selectedOperation=validGraphId(raw)?raw:undefined;
 const [open,setOpen]=useState(!!selectedOperation);const [draft,setDraft]=useDraft(`task-create:${project}`,blank,validDraft);const [frozenIntent,setFrozen]=useState<FrozenTaskCreate|null>(null);
 const [operationStatus,setStatus]=useState<TaskOperation|null>(null);const [verifiedTask,setCreated]=useState<GraphNode|null>(null);const [error,setError]=useState<string|null>(null);const [readError,setReadError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 const active=useRef(true),busyRef=useRef(false),frozenRef=useRef<FrozenTaskCreate|null>(null),request=useRef<AbortController|null>(null);const dialog=useRef<HTMLDialogElement>(null);const initialLookup=useRef<string|null>(null);const titleId=useId();
 const sequence=useRef(0),urlOperation=useRef(selectedOperation),internalUrl=useRef<{value:string|undefined}|null>(null);
 const operation=selectedOperation??(internalUrl.current?.value===frozenIntent?.operationId?frozenIntent?.operationId:undefined);
 const frozen=frozenIntent?.operationId===operation?frozenIntent:null;
 const status=operationStatus?.operation_id===operation?operationStatus:null;
 const created=status?.state==="confirmed"&&verifiedTask?.id===operation?verifiedTask:null;
 const context=useQuery({queryKey:queryKey(queryContext,"task-create-context",{project}),enabled:open&&!operation,retry:false,refetchOnWindowFocus:false,staleTime:0,
  queryFn:async({signal})=>adaptGraphPage(await apiGet<unknown>(`${graphPath(project,"task")}?limit=1`,signal),project,"task").project});
 useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
 useLayoutEffect(()=>{
  if(urlOperation.current===selectedOperation)return;
  urlOperation.current=selectedOperation;const own=internalUrl.current!==null&&internalUrl.current.value===selectedOperation;internalUrl.current=null;
  if(own)return; // Our first submit/revise changes the URL without replacing its intent.
  sequence.current++;request.current?.abort();request.current=null;busyRef.current=false;setBusy(false);
  clearPrivate();setOpen(!!selectedOperation);
 },[selectedOperation]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current?.close();},[open]);
 function clearPrivate(){frozenRef.current=null;setFrozen(null);setStatus(null);setCreated(null);setDraft({...blank});setReadError(null);setError(null);initialLookup.current=null;}
 function current(ticket:number){return active.current&&sequence.current===ticket;}
 function revokeAccess(reason:ApiError){reportAccessDenied(reason);sequence.current++;active.current=false;request.current?.abort();request.current=null;busyRef.current=false;setBusy(false);clearPrivate();onAccessRevoked();void client.invalidateQueries({queryKey:["bootstrap"]});}
 function operationParam(value?:string){internalUrl.current={value};setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set("operation",value);else next.delete("operation");return next;},{replace:true});}
 async function verifyTask(value:TaskOperation,signal:AbortSignal,ticket:number){
  if(value.state!=="confirmed"||!value.receipt)return;
  try{
   const record=adaptGraphDetail(await apiGet<unknown>(graphPath(project,"task",value.task_id),signal),project,"task",value.task_id);
   if(record.project.workspace_id!==value.receipt.workspace_id)throw new Error("Task workspace changed");
   if(current(ticket)){setCreated(record.data);setReadError(null);void client.invalidateQueries({predicate:q=>q.queryKey[0]==="aq"&&q.queryKey[1]===queryContext.principalId&&["human-graph-list","overview-task-contributions"].includes(String(q.queryKey[4]))});}
  }catch(reason){if(current(ticket)){if(reason instanceof ApiError&&[401,403].includes(reason.status??0)){revokeAccess(reason);return;}if(reason instanceof ApiError&&reason.status===426){reportIncompatible("tasks.create");return;}setCreated(null);setReadError("The creation receipt is confirmed, but the task record could not be read. Check the task record again.");}}
 }
 async function execute(kind:"submit"|"lookup"|"recover",id:string,intent?:FrozenTaskCreate){
  const ticket=++sequence.current;const controller=new AbortController();request.current=controller;
  try{
   const path=kind==="submit"?graphPath(project,"task"):`/api/human/operations/${encodeURIComponent(id)}${kind==="recover"?"/recover":""}`;
   const raw=await taskOperationRequest(kind==="lookup"?"GET":"POST",path,kind==="submit"?intent!.bytes:kind==="recover"?"{}":undefined,controller.signal);
   const value=adaptTaskOperation(raw,{operationId:id,project,actor:queryContext.principalId,...(intent?{digest:intent.digest}:{})});
   if(!current(ticket))return;setStatus(value);setCreated(null);setReadError(null);setError(null);if(value.state==="confirmed")setDraft({...blank});await verifyTask(value,controller.signal,ticket);
  }catch(reason){if(current(ticket)){if(reason instanceof ApiError&&[401,403].includes(reason.status??0)){revokeAccess(reason);return;}if(reason instanceof ApiError&&reason.status===426){reportIncompatible("tasks.create");return;}setCreated(null);setError("The operation outcome is not confirmed. Check its status before starting another task.");}}
  finally{if(current(ticket)){setBusy(false);busyRef.current=false;}if(request.current===controller)request.current=null;}
 }
 async function lookup(){if(!operation||busyRef.current)return;busyRef.current=true;setBusy(true);await execute("lookup",operation,frozenRef.current?.operationId===operation?frozenRef.current:undefined);}
 useEffect(()=>{
  if(!selectedOperation||frozenRef.current?.operationId===selectedOperation||initialLookup.current===selectedOperation)return;
  initialLookup.current=selectedOperation;if(busyRef.current)return;busyRef.current=true;setBusy(true);void execute("lookup",selectedOperation);
  // A reload recovers server-retained identity; it never reconstructs a POST body.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selectedOperation]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(busyRef.current||operation||!context.data||context.isFetching)return;
  const problem=validateTaskDraft(draft);if(problem){setError(problem);return;}
  busyRef.current=true;setBusy(true);setError(null);
  const preparation=sequence.current;
  try{const intent=await freezeTaskCreate(project,queryContext.principalId,context.data.revision,draft);if(!current(preparation))return;setStatus(null);setCreated(null);setReadError(null);frozenRef.current=intent;setFrozen(intent);operationParam(intent.operationId);await execute("submit",intent.operationId,intent);}
  catch{if(current(preparation)){setError("The task request could not be prepared. Your draft is preserved.");setBusy(false);busyRef.current=false;}}
 }
 async function recover(){if(!operation||busyRef.current||!status?.recovery.allowed)return;busyRef.current=true;setBusy(true);await execute("recover",operation,frozenRef.current?.operationId===operation?frozenRef.current:undefined);}
 async function retryOriginal(){if(!frozenRef.current||frozenRef.current.operationId!==operation||busyRef.current)return;busyRef.current=true;setBusy(true);await execute("submit",frozenRef.current.operationId,frozenRef.current);}
 function revise(){if(!status||!["conflict","rejected","confirmed"].includes(status.state)||busyRef.current)return;if(status.state==="confirmed")setDraft({...blank});frozenRef.current=null;setFrozen(null);setStatus(null);setCreated(null);setReadError(null);setError(null);initialLookup.current=null;operationParam();void context.refetch();}
 function leaveConfirmedTask(){setOpen(false);clearPrivate();}
 const terminal=status&&["conflict","rejected","confirmed"].includes(status.state);
 return <>
  <div className={styles.action}><ActionButton className={styles.primary} onClick={()=>{setOpen(true);if(!operation)void context.refetch();}}><Plus size={18} aria-hidden/>{operation?"Task operation":"Create task"}</ActionButton></div>
  <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
   <header className={styles.header}><h2 id={titleId}>{operation?"Task operation":"Create task"}</h2><ActionButton onClick={()=>setOpen(false)} aria-label="Close task composer">Close</ActionButton></header>
   <p className={styles.meta}>{context.data?.name??"Selected project"} · Creating a task does not start an agent.</p>
   {error&&<p role="alert" className={styles.warning}>{error}</p>}
   {(!operation||frozen)&&<form onSubmit={e=>void submit(e)}>
    <fieldset disabled={busy||!!operation} className={styles.fields}>
     <label>Title<input value={draft.title} required maxLength={1024} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/></label>
     <label>Description<textarea value={draft.body} rows={6} onChange={e=>setDraft(v=>({...v,body:e.target.value}))}/></label>
     <label>Acceptance criteria<textarea value={draft.acceptance_criteria} rows={4} onChange={e=>setDraft(v=>({...v,acceptance_criteria:e.target.value}))}/></label>
     <label>Initial task state<select value={draft.task_state} onChange={e=>setDraft(v=>({...v,task_state:e.target.value as TaskDraft["task_state"]}))}><option value="draft">Draft</option><option value="active">Active</option></select></label>
    </fieldset>
    {!operation&&<footer className={styles.footer}><p className={styles.meta}>{context.isError?"Project context unavailable. Refresh it before submitting.":!context.data||context.isFetching?"Checking project context…":"Creation uses the current project revision."}</p>{context.isError&&<ActionButton onClick={()=>void context.refetch()}>Refresh project context</ActionButton>}<ActionButton type="submit" className={styles.primary} disabled={busy||!context.data||context.isError||context.isFetching}>Create task</ActionButton></footer>}
   </form>}
   {operation&&!frozen&&(draft.title||draft.body||draft.acceptance_criteria)&&<section aria-label="Recovered local task draft">
    <p>Recovered local draft. Check the retained operation before submitting again.</p>
    <div className={styles.fields}>
     <label>Title<input readOnly value={draft.title}/></label>
     <label>Description<textarea readOnly rows={6} value={draft.body}/></label>
     <label>Acceptance criteria<textarea readOnly rows={4} value={draft.acceptance_criteria}/></label>
     <p>Initial task state: {draft.task_state}</p>
    </div>
   </section>}
   {operation&&<section className={styles.operation} aria-label="Task creation status">
    <p role="status">{busy?"Checking task operation…":created?"Task created and its record verified.":status?.state==="confirmed"?"Task creation receipt confirmed.":status?.state==="conflict"?"Task creation conflicted. Your draft is preserved.":status?.state==="rejected"?"Task creation was rejected. Your draft is preserved.":status?.state==="pending"?"Task creation is pending.":"Task creation outcome is uncertain."}</p>
    {readError&&<p className={styles.warning}>{readError}</p>}
    <div className={styles.footer}>{created&&<Link className={styles.openTask} onClick={e=>{if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey)leaveConfirmedTask();}} to={{pathname:`/work/${created.id}`,search:scopeSearch({kind:"project",project_id:project})}}>Open created task</Link>}<ActionButton disabled={busy} onClick={()=>void lookup()}>Check status</ActionButton>{status?.recovery.allowed&&<ActionButton disabled={busy} onClick={()=>void recover()}>Recover retained request</ActionButton>}{!status&&frozen&&<ActionButton disabled={busy} onClick={()=>void retryOriginal()}>Retry exact submission</ActionButton>}{terminal&&<ActionButton disabled={busy} onClick={revise}>{status.state==="confirmed"?"Start another task":"Revise draft"}</ActionButton>}</div>
    {status&&!status.recovery.allowed&&status.recovery.reason&&<p className={styles.meta}>{status.recovery.reason}</p>}
    <details className={styles.details}><summary>Operation reference</summary><p>{operation}</p>{status&&<p>{status.request_digest}</p>}{status?.receipt&&<dl><dt>Original workspace</dt><dd>{status.receipt.workspace_id}</dd><dt>Creation change set</dt><dd>{status.receipt.change_set_id}</dd><dt>Initial record version</dt><dd>{status.receipt.version}</dd><dt>Initial content revision</dt><dd>{status.receipt.content_revision}</dd></dl>}<p>Keep this page address to inspect the same operation after a reload.</p></details>
   </section>}
  </dialog>
 </>;
}
