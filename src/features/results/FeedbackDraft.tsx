import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link,useSearchParams} from "react-router";
import {apiGet,ApiError} from "../../api/client";
import {queryKey} from "../../api/queryKeys";
import {adaptGraphPage,validGraphId} from "../../api/adapters/humanGraph";
import {graphPath} from "../../api/humanGraphReads";
import {validateResultPayload,type ResultComment,type ResultDetail} from "../../api/adapters/resultsFeedback";
import type {FeedbackTaskStatus} from "../../api/wire/resultsFeedback";
import {ContractError} from "../../api/adapters/contract";
import {useSession} from "../../app/session";
import {scopeSearch} from "../../app/scope";
import {useProjects} from "../../app/useProjects";
import {ActionButton} from "../../components/layout/Workspace";
import {OperationStatus,useResultOperation} from "./useResultOperation";
import styles from "./Results.module.css";
export function FeedbackDraft({detail,comments,initial,open=true,onClose,onRefresh}:{detail:ResultDetail;comments:ResultComment[];initial?:string;open?:boolean;onClose():void;onRefresh?():Promise<ResultComment[]>}){
 const {bootstrap,queryContext,reportAccessDenied,reportIncompatible}=useSession(),projects=useProjects(),[params,setParams]=useSearchParams();
 const initialId=useRef(params.get("feedback_result")===detail.result.id&&params.get("feedback_revision")===detail.revision.revision&&validGraphId(params.get("feedback_operation"))?params.get("feedback_operation")!:undefined);const dialog=useRef<HTMLDialogElement>(null);
 const [commentId,setCommentId]=useState(initial??comments[0]?.id??""),[mode,setMode]=useState<"create"|"link">("create");
 const [title,setTitle]=useState("Review result feedback"),[description,setDescription]=useState(comments.find(c=>c.id===(initial??comments[0]?.id))?.body??""),[criteria,setCriteria]=useState(""),[project,setProject]=useState(detail.result.project_id),[parent,setParent]=useState(""),[existing,setExisting]=useState("");
 const [artifacts,setArtifacts]=useState<string[]>([]),[error,setError]=useState<string|null>(null),[linked,setLinked]=useState<string|null>(null);
 const operation=useResultOperation(detail.result.project_id,"results.feedback",initialId.current?{id:initialId.current,recoveryPath:`/api/v1/feedback-tasks/${initialId.current}/recover`}:undefined);const origin=useRef<Record<string,unknown>|null>(null);
 const enabled=bootstrap.capability("results.feedback").enabled;
 const verification=useRef<AbortController|null>(null);useEffect(()=>()=>verification.current?.abort(),[]);
 const comment=comments.find(c=>c.id===commentId);
 useEffect(()=>{if(!commentId&&comments[0]){setCommentId(comments[0].id);setDescription(value=>value||comments[0]!.body);}},[commentId,comments]);
 const context=useQuery({queryKey:queryKey(queryContext,"result-feedback-context",{project}),enabled:enabled&&validGraphId(project)&&mode==="create",retry:false,refetchOnWindowFocus:false,
  queryFn:async({signal})=>adaptGraphPage(await apiGet<unknown>(`${graphPath(project,"task")}?limit=1`,signal),project,"task").project});
 useEffect(()=>{const element=dialog.current;if(open)element?.showModal();else element?.close();return()=>element?.close();},[open]);
 useEffect(()=>{if(initialId.current)void operation.lookup()?.then(value=>{if(value)void verify();});
 // Recover identity from the URL; never reconstruct a create POST.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function verify(id=operation.id){
  if(!id||mode!=="create")return;verification.current?.abort();const controller=new AbortController();verification.current=controller;
  try{const raw=await apiGet<unknown>(`/api/v1/feedback-tasks/${id}`,controller.signal);if(controller.signal.aborted)return;validateResultPayload("Envelope",raw);const envelope=raw as {data:FeedbackTaskStatus;scope:{kind:string;project_id?:string}};if(envelope.scope.kind!=="project"||envelope.scope.project_id!==detail.result.project_id)throw new ContractError("Feedback receipt scope changed");const data=envelope.data;
   if(!origin.current){if(data.origin.result_id!==detail.result.id||data.origin.revision!==detail.revision.revision)throw new ContractError("Feedback origin changed");origin.current=data.origin as unknown as Record<string,unknown>;setTitle(data.origin.title);setDescription(data.origin.description);setCriteria(data.origin.acceptance_criteria);setProject(data.origin.project_id);setParent(data.origin.parent_id??"");setCommentId(data.origin.comment_id);setArtifacts(data.origin.artifacts.map(a=>a.artifact_id));}
   if(data.operation_id!==id||data.task_id!==id||data.result_id!==detail.result.id||data.revision!==detail.revision.revision||JSON.stringify(data.origin)!==JSON.stringify(origin.current)){
    // JSON object property order is not part of the wire identity.
    if(data.operation_id!==id||data.task_id!==id||data.result_id!==detail.result.id||data.revision!==detail.revision.revision||!origin.current||Object.entries(origin.current).some(([k,v])=>JSON.stringify(v)!==JSON.stringify((data.origin as unknown as Record<string,unknown>)[k])))throw new ContractError("Feedback receipt pins changed");
   }
   if(data.creation_disposition==="confirmed"&&data.link_confirmed){setLinked(data.task_id);setError(null);}else setError("Task creation or linking is not yet confirmed. Check the original operation.");
  }catch(reason){if(controller.signal.aborted)return;if(reason instanceof ApiError&&[401,403].includes(reason.status??0))reportAccessDenied(reason);else if(reason instanceof ApiError&&reason.status===426)reportIncompatible("results.feedback");setError("The feedback task link could not be verified. Check the original operation.");}
 }
 async function submit(event:React.FormEvent){
  event.preventDefault();if(!enabled||operation.id||!comment||mode==="create"&&!context.data)return;setError(null);
  try{
   const common={operation_id:crypto.randomUUID(),expected_version:comment.thread_version,thread_id:comment.thread_id,comment_id:comment.id,comment_revision:comment.revision,result_id:detail.result.id,revision:detail.revision.revision,artifacts:detail.assessment.artifacts.filter(a=>artifacts.includes(a.artifact_id))};
   const body=mode==="create"?{...common,project_id:project,expected_project_revision:context.data!.revision,title,description,acceptance_criteria:criteria,...(parent?{parent_id:parent}:{})}:{...common,project_id:detail.result.project_id,task_id:existing};
   validateResultPayload(mode==="create"?"FeedbackDraft":"FeedbackLink",body);origin.current=body;
   if(mode==="create")setParams(old=>{const next=new URLSearchParams(old);next.set("feedback_operation",body.operation_id);next.set("feedback_result",detail.result.id);next.set("feedback_revision",detail.revision.revision);return next;},{replace:true});
   const op=await operation.submit("POST",mode==="create"?"/api/v1/feedback-tasks":"/api/v1/feedback-links",body,mode==="create"?`/api/v1/feedback-tasks/${body.operation_id}/recover`:undefined);
   if(op?.disposition==="confirmed"&&mode==="link")setLinked(existing);
   if(mode==="create"&&op?.disposition==="confirmed")await verify(body.operation_id);
  }catch{setError(operation.id?"The feedback task link could not be verified. Check the original operation.":"Check the title, description, criteria and task pins before submitting.");}
 }
 async function refreshGuards(){
  try{const [next,latest]=await Promise.all([context.refetch(),onRefresh?.()]);if(mode==="create"&&next.error)throw next.error;
   if(latest&&origin.current){const original=origin.current;const pinned=latest.find(c=>c.id===original.comment_id);if(!pinned||pinned.revision!==original.comment_revision)throw new Error("Comment changed");}
   setError(null);setParams(old=>{const next=new URLSearchParams(old);for(const key of ["feedback_operation","feedback_result","feedback_revision"])next.delete(key);return next;},{replace:true});
  }catch{setError("Could not refresh the original comment and project guards. Keep this operation reference and reopen the exact revision.");throw new Error("Feedback guards unavailable");}
 }
 const pins=detail.assessment.artifacts;
 return <dialog ref={dialog} className={styles.draftDialog} aria-label="Create feedback task" onCancel={e=>{e.preventDefault();onClose();}}>
  <header className={styles.panelHeader}><h2>Create feedback task</h2><ActionButton onClick={onClose}>Close draft</ActionButton></header>
  <p className={styles.meta}>Discussion stays separate from work. Creating or linking a task leaves the thread open.</p>
  {!comments.length&&<p>Post a comment first to pin this feedback to an exact discussion.</p>}
  {error&&<p role="alert">{error}</p>}
  <form onSubmit={e=>void submit(e)}><fieldset disabled={!enabled||!!operation.id} className={styles.fields}>
   <label>Feedback comment<select value={commentId} onChange={e=>{setCommentId(e.target.value);setDescription(comments.find(c=>c.id===e.target.value)?.body??"");}}>{comments.map(c=><option key={c.id} value={c.id}>{c.body.slice(0,90)}</option>)}</select></label>
   <label>Action<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="create">Create a new task</option><option value="link">Link existing task</option></select></label>
   {mode==="create"?<>
    <label>Title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Description<textarea required rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <label>Acceptance criteria<textarea required rows={3} value={criteria} onChange={e=>setCriteria(e.target.value)}/></label>
    <label>Project<select value={project} onChange={e=>setProject(e.target.value)}>{[...new Map([{id:detail.result.project_id,label:detail.result.project_id},...(projects.data?.view??[])].map(p=>[p.id,p])).values()].map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
    <label>Parent task (optional)<input value={parent} onChange={e=>setParent(e.target.value)} placeholder="Task ID"/></label>
   </>:<label>Existing task ID<input required value={existing} onChange={e=>setExisting(e.target.value)}/></label>}
   <details><summary>Exact pins</summary><p className={styles.meta}>Result {detail.result.id} · revision {detail.revision.revision}</p>{comment&&<p className={styles.meta}>Comment {comment.id} · revision {comment.revision}</p>}{pins.map(a=><label key={a.artifact_id}><input type="checkbox" checked={artifacts.includes(a.artifact_id)} onChange={e=>setArtifacts(old=>e.target.checked?[...old,a.artifact_id]:old.filter(id=>id!==a.artifact_id))}/>{a.artifact_id} · {a.digest}</label>)}</details>
  </fieldset>
  {!operation.id&&<ActionButton type="submit" className={styles.primary} disabled={!enabled||!comment||mode==="create"&&(!context.data||context.isFetching||context.isError)}>{mode==="create"?"Create linked task":"Link existing task"}</ActionButton>}
  {mode==="create"&&context.isError&&<p>Project revision unavailable. <ActionButton onClick={()=>void context.refetch()}>Refresh project</ActionButton></p>}
  </form>
  <OperationStatus operation={operation} recover={mode==="create"} onCheck={value=>{if(mode==="link"&&value.disposition==="confirmed")setLinked(existing);else if(mode==="create")void verify();}} onRevise={refreshGuards}/>
  {operation.id&&mode==="create"&&<p className={styles.meta}><Link to={{pathname:`/results/${detail.result.id}/revisions/${detail.revision.revision}`,search:`${scopeSearch({kind:"project",project_id:detail.result.project_id})}&feedback_operation=${operation.id}&feedback_result=${detail.result.id}&feedback_revision=${detail.revision.revision}`}}>Retained operation</Link></p>}
  {linked&&<ActionButton onClick={()=>{operation.reset();setLinked(null);setError(null);initialId.current=undefined;setParams(old=>{const next=new URLSearchParams(old);for(const key of ["feedback_operation","feedback_result","feedback_revision"])next.delete(key);return next;},{replace:true});void context.refetch();}}>Start another feedback task</ActionButton>}
  {linked&&<section role="status"><p>{mode==="create"?"Feedback task created and linked. Thread remains open.":"Existing task linked. Thread remains open."}</p><Link to={{pathname:`/work/${linked}`,search:scopeSearch({kind:"project",project_id:project})}}>Open feedback task</Link></section>}
 </dialog>;
}
