import {useEffect, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Link, useLocation} from "react-router";
import {useSession} from "../../../app/session";
import {useProjects} from "../../../app/useProjects";
import {useDraft} from "../../../app/useDraft";
import {apiGet, ApiError} from "../../../api/client";
import {isRecord} from "../../../api/adapters/contract";
import {validGraphId} from "../../../api/adapters/humanGraph";
import {adaptTaskOperation, freezeTaskCreate, type FrozenTaskCreate, type TaskOperation} from "../../../api/adapters/taskCreate";
import {taskOperationRequest} from "../../../api/taskCreateClient";
import type {NodeView} from "../../../api/adapters/swarm";
import {ActionButton} from "../../../components/layout/Workspace";
import styles from "../../work/CreateTask.module.css";

type Eligible = {id:string;revision:string};
function eligible(raw:unknown):Eligible[]{
  if(!isRecord(raw)||!Array.isArray(raw.projects)||raw.projects.length>128)throw Error("Invalid launch projects");
  return raw.projects.map(p=>{
    if(!isRecord(p)||!validGraphId(p.id)||typeof p.revision!=="string"||!/^[1-9][0-9]{0,18}$/.test(p.revision))throw Error("Invalid launch project");
    return {id:p.id,revision:p.revision};
  });
}
function intent(v:unknown):v is FrozenTaskCreate|null {
  return v===null||(isRecord(v)&&validGraphId(v.project)&&validGraphId(v.actor)&&validGraphId(v.operationId)&&typeof v.bytes==="string"&&v.bytes.length<=65536&&typeof v.digest==="string"&&/^sha256:[a-f0-9]{64}$/.test(v.digest));
}
export function WorkerLaunch({node}:{node:NodeView}){
  const {bootstrap,queryContext}=useSession();
  const cap=bootstrap.capability("tasks.create");
  const projects=useProjects();const location=useLocation();
  const [open,setOpen]=useState(false),[project,setProject]=useState(""),[prompt,setPrompt]=useState("");
  const [frozen,setFrozen]=useDraft<FrozenTaskCreate|null>(`worker-launch:${node.id}`,null,intent);
  const [status,setStatus]=useState<TaskOperation|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const lock=useRef(false),dialog=useRef<HTMLDialogElement>(null),alive=useRef(true);
  const choices=useQuery({queryKey:["worker-launch-projects",queryContext.principalId,queryContext.authorizationRevision,node.id],enabled:open&&cap.enabled&&!frozen,retry:false,
    queryFn:async({signal})=>eligible(await apiGet(`/api/human/workers/${encodeURIComponent(node.id)}/launch-projects`,signal))});
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open)dialog.current?.close();},[open]);
  const started=frozen?node.agents.find(a=>a.task?.id===frozen.operationId):undefined;
  const selected=choices.data?.find(p=>p.id===project)??choices.data?.[0];
  async function execute(kind:"submit"|"lookup"|"recover",saved:FrozenTaskCreate){
    if(!cap.enabled){lock.current=false;setBusy(false);return;}
    try{
      const path=kind==="submit"?`/api/human/projects/${saved.project}/workers/${node.id}/launch`:`/api/human/operations/${saved.operationId}${kind==="recover"?"/recover":""}`;
      const raw=await taskOperationRequest(kind==="lookup"?"GET":"POST",path,kind==="submit"?saved.bytes:kind==="recover"?"{}":undefined);
      const value=adaptTaskOperation(raw,{operationId:saved.operationId,project:saved.project,actor:queryContext.principalId,digest:saved.digest});
      if(alive.current){setStatus(value);setError(null);}
    }catch(e){if(alive.current){
      if(kind==="submit"&&e instanceof ApiError&&[400,403,404,409,413,422].includes(e.status??0)){
        setFrozen(null);setError(e.serverMessage??"AQ refused the launch. Check the worker and project before retrying.");
      }else setError("Launch outcome is uncertain. Check status before submitting again.");
    }}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();if(!cap.enabled||lock.current||frozen||!selected||!prompt.trim())return;
    lock.current=true;setBusy(true);setError(null);
    try{
      const saved=await freezeTaskCreate(selected.id,queryContext.principalId,selected.revision,{title:[...prompt.trim().split("\n")[0]!].slice(0,120).join(""),body:prompt.trim(),acceptance_criteria:"Complete the owner's request and report the result.",task_state:"active"});
      if(!alive.current){lock.current=false;return;}setFrozen(saved);await execute("submit",saved);
    }catch(e){lock.current=false;if(alive.current){setBusy(false);setError(e instanceof Error?e.message:"Cannot prepare launch");}}
  }
  function check(kind:"lookup"|"recover"|"submit"){if(!frozen||lock.current)return;lock.current=true;setBusy(true);void execute(kind,frozen);}
  const search=new URLSearchParams(location.search);if(started)search.set("select",`agent:${started.sessionId}`);
  return <>
    <ActionButton disabled={!cap.enabled||(node.health!=="online"&&!frozen)} title={!cap.enabled?cap.reason:node.health!=="online"?"Select an online worker":undefined} onClick={()=>setOpen(true)}>Launch agent</ActionButton>
    <dialog ref={dialog} className={styles.dialog} aria-label="Launch agent" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}>
      <header className={styles.header}><h2>Launch agent</h2><ActionButton onClick={()=>setOpen(false)}>Close</ActionButton></header>
      <p className={styles.meta}>Worker: {node.name}. The agent uses the project's configured model and workspace.</p>
      <p className={styles.meta}><Link to="/settings?tab=projects">Manage projects</Link> · Only started projects with worker setup appear here.</p>
      {error&&<p role="alert" className={styles.warning}>{error}</p>}
      {!frozen&&<form onSubmit={e=>void submit(e)}><fieldset className={styles.fields} disabled={busy||!cap.enabled}>
        <label>Project<select value={selected?.id??""} onChange={e=>setProject(e.target.value)}>{choices.data?.map(p=><option value={p.id} key={p.id}>{projects.data?.view.find(v=>v.id===p.id)?.label??p.id}</option>)}</select></label>
        <label>What should the agent do?<textarea required rows={6} maxLength={16000} value={prompt} onChange={e=>setPrompt(e.target.value)}/></label>
      </fieldset>
      {choices.isError?<p role="alert">Could not load runnable projects. <ActionButton onClick={()=>void choices.refetch()}>Retry</ActionButton></p>:choices.isPending?<p>Checking runnable projects…</p>:!choices.data.length?<p>No runnable projects. Enable a project for worker execution first.</p>:null}
      <ActionButton className={styles.primary} type="submit" disabled={!cap.enabled||busy||!selected||choices.isFetching||choices.isError||!prompt.trim()}>Launch on {node.name}</ActionButton></form>}
      {frozen&&<section aria-label="Agent launch status">
        <p role="status">{busy?"Checking launch…":started?"Agent started.":status?.state==="confirmed"?"Launch queued on this worker. Waiting for an available slot and startup checks…":status?.state==="conflict"||status?.state==="rejected"?"Launch was refused.":"Launch is awaiting confirmation."}</p>
        {!started&&node.holding.length>0&&<p className={styles.warning}>{node.holding.map(h=>[h.message,h.remedy].filter(Boolean).join(" — ")).join("; ")}</p>}
        {!started&&node.health!=="online"&&<p className={styles.warning}>This worker is offline. The launch is still assigned to it.</p>}
        <Link to={`/work/${frozen.operationId}?scope=project%3A${frozen.project}`}>View task and startup status</Link>
        {started&&<Link className={styles.openTask} to={{pathname:"/agents",search:`?${search}`}} onClick={()=>setOpen(false)}>Open agent terminal</Link>}
        <div className={styles.footer}><ActionButton disabled={busy} onClick={()=>check("lookup")}>Check status</ActionButton>
          {status?.recovery.allowed&&<ActionButton disabled={busy} onClick={()=>check("recover")}>Recover launch</ActionButton>}
          {!status&&<ActionButton disabled={busy} onClick={()=>check("submit")}>Retry same launch</ActionButton>}
          {(started||status?.state==="confirmed"||status?.state==="conflict"||status?.state==="rejected")&&<ActionButton disabled={busy} onClick={()=>{setFrozen(null);setStatus(null);setPrompt("");void choices.refetch();}}>Launch another agent</ActionButton>}
        </div>
        <details className={styles.details}><summary>Launch reference</summary>{frozen.operationId}</details>
      </section>}
    </dialog>
  </>;
}
