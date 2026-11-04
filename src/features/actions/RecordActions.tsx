import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { ContractError } from "../../api/adapters/contract";
import { apiGet, ApiError } from "../../api/client";
import { adaptGraphDetail, adaptGraphPage, validGraphId } from "../../api/adapters/humanGraph";
import { graphPath, useGraphNeighborhood } from "../../api/humanGraphReads";
import { ActionButton } from "../../components/layout/Workspace";
import { actionCapability, actionLabels, actionRequest, freezeAction, type ActionContext, type ActionKind, type ActionOperation, type FrozenAction } from "./actionClient";
import styles from "./RecordActions.module.css";

type Draft={title:string;body:string;acceptance:string;labels:string;labelsEdited:boolean;category:string;reason:string;blocker:string;edge:string;successor:string;verdict:string;url:string;confirm:boolean};
function draftFor(record:ActionContext,author:boolean):Draft {const n=author?undefined:record.data;return {title:n?.title??"",body:n?.body??"",acceptance:n?.acceptance_criteria??"",labels:n?.labels.join(", ")??"",labelsEdited:false,category:n?.content_type??"note",reason:"",blocker:"",edge:"",successor:"",verdict:"verified",url:"",confirm:false};}
/** `kinds` narrows the offered actions (for example to those a compact header can show); it never adds kinds. */
export function RecordActions(props:{record:ActionContext;author?:boolean;pinned?:string;kinds?:ActionKind[]}) {
  const {queryContext}=useSession();
  return <Actions key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.record.project.id}:${props.author?"author":props.record.data?.id}`} {...props}/>;
}
function Actions({record,author=false,pinned,kinds:only}:{record:ActionContext;author?:boolean;pinned?:string;kinds?:ActionKind[]}) {
  const {bootstrap,queryContext,reportAccessDenied,reportIncompatible}=useSession();const cache=useQueryClient();
  const kinds:ActionKind[]=(author?["knowledge.author"] as ActionKind[]:record.data?.kind==="task"?["task.edit","task.cancel","task.retry","task.dependency.add","task.dependency.remove"] as ActionKind[]:["knowledge.correct","knowledge.verify","knowledge.retire"] as ActionKind[]).filter(k=>!only||only.includes(k));
  const [kind,setKind]=useState<ActionKind|null>(null),[open,setOpen]=useState(false),[draft,setDraft]=useState(()=>draftFor(record,author));
  const [baseline,setBaseline]=useState(record),[intent,setIntent]=useState<FrozenAction|null>(null),[operation,setOperation]=useState<ActionOperation|null>(null);
  const [retired,setRetired]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[accessLost,setAccessLost]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),lock=useRef(false),current=useRef(true),controller=useRef<AbortController|null>(null),frozen=useRef<FrozenAction|null>(null);
  const dependency=useGraphNeighborhood(kind==="task.dependency.remove"?record.project.id:"",record.data?.id??"");
  const unsettled=!!intent&&(retired||unknown||operation?.disposition==="pending"||operation?.disposition==="unknown"||!operation);
  const capability=(k:ActionKind)=>{const union=bootstrap.capability("dashboard.actions");return union.enabled?bootstrap.capability(actionCapability(k)):union;};
  useEffect(()=>{current.current=true;return()=>{current.current=false;controller.current?.abort();};},[]);
  useEffect(()=>{if(open){if(!dialog.current?.open)dialog.current?.showModal();}else if(dialog.current?.open)dialog.current.close();},[open]);
  async function run(value:FrozenAction,lookup=false){
    if(lock.current||accessLost)return;lock.current=true;setBusy(true);const abort=new AbortController();controller.current=abort;
    try {
      const next=await actionRequest(value,lookup,abort.signal);if(!current.current)return;
      if(operation?.request_digest&&operation.operation_id===next.operation_id&&operation.request_digest!==next.request_digest)throw new ContractError("Operation identity changed");
      setOperation(next);setUnknown(false);setError(null);
      if(next.disposition==="confirmed")await cache.invalidateQueries({predicate:q=>q.queryKey[0]==="aq"&&q.queryKey[1]===queryContext.principalId&&["human-graph-list","human-graph-detail","human-graph-neighborhood","overview-task-contributions"].includes(String(q.queryKey[4]))});
    }catch(reason){if(!current.current)return;
      if(reason instanceof ApiError&&[401,403].includes(reason.status??0)){setAccessLost(true);setDraft(draftFor({project:record.project},true));setOperation(null);reportAccessDenied(reason);setError("Access changed. Reload access before checking the operation.");}
      else if(reason instanceof ApiError&&reason.status===426){reportIncompatible("dashboard.actions");setUnknown(true);}
      else if(reason instanceof ApiError&&reason.status===410){setRetired(true);setUnknown(false);setError(null);}
      else if(!lookup&&reason instanceof ApiError&&reason.status===409){setOperation({operation_id:value.id,disposition:"conflict",request_digest:"",subject_refs:[],receipt_refs:[],affected_entities:[],current_versions:reason.envelope?.current_versions,recovery:"refresh_and_review"});setUnknown(false);setError(reason.envelope?.message??"The expected version has changed.");}
      else if(!lookup&&reason instanceof ApiError&&!reason.effectUnknown&&[400,404,413,422].includes(reason.status??0)){setOperation({operation_id:value.id,disposition:"rejected",request_digest:"",subject_refs:[],receipt_refs:[],affected_entities:[],recovery:"refresh_and_review"});setUnknown(false);setError(reason.envelope?.message??"The server refused this action. Review the record and permissions.");}
      else{setUnknown(true);setError(null);}
    }finally{lock.current=false;if(current.current)setBusy(false);if(controller.current===abort)controller.current=null;}
  }
  // Reconcile immediately after admission uncertainty; subsequent reads are paced.
  const firstLookup=useRef<string|null>(null);
  useEffect(()=>{
    if(!intent||!unsettled||busy||accessLost||retired)return;
    const delay=firstLookup.current===intent.id?2000:0;firstLookup.current=intent.id;
    const timer=setTimeout(()=>void run(intent,true),delay);return()=>clearTimeout(timer);
  },[intent,unsettled,busy,accessLost,retired]);
  function launch(k:ActionKind){
    if(unsettled){if(k===kind)setOpen(true);return;}
    frozen.current=null;setIntent(null);setOperation(null);setRetired(false);setUnknown(false);setError(null);setBaseline(record);setDraft(draftFor(record,author));setKind(k);setOpen(true);
  }
  function fields(k:ActionKind):{payload:Record<string,unknown>;reason?:string}{
    if(["task.edit","knowledge.author","knowledge.correct"].includes(k)){
      const labels=k==="knowledge.author"||draft.labelsEdited?[...new Set(draft.labels.split(",").map(x=>x.trim()).filter(Boolean))]:undefined;
      if(labels&&(labels.length>16||labels.some(v=>new TextEncoder().encode(v).length>128)))throw new Error("Use at most 16 labels, each up to 128 bytes.");
      if(!draft.title.trim()||Array.from(draft.title).length>512)throw new Error("Enter a title of at most 512 characters.");
      if(new TextEncoder().encode(draft.body).length>32768||new TextEncoder().encode(draft.acceptance).length>8192)throw new Error("Shorten the description or acceptance criteria.");
      return {payload:{title:draft.title,body:draft.body,...(labels?{labels}:{}),...(k==="task.edit"?{acceptance_criteria:draft.acceptance}:{content_type:draft.category})}};
    }
    if(k==="task.dependency.add"){if(!validGraphId(draft.blocker)||draft.blocker===record.data?.id)throw new Error("Choose another task's ID as the blocker.");return {payload:{blocker_id:draft.blocker}};}
    if(k==="task.dependency.remove"){const edge=dependency.data?.data.edges.find(e=>e.id===draft.edge&&e.target===record.data?.id&&e.edge_type==="blocks");if(!edge)throw new Error("Choose a recorded dependency.");return {payload:{edge_id:edge.id,edge_version:edge.version}};}
    if(k==="task.retry")return {payload:{}};
    if(!draft.reason.trim()||new TextEncoder().encode(draft.reason).length>1024)throw new Error("Enter a reason of at most 1024 bytes.");
    if(k==="knowledge.verify"){
      let url:URL;try{url=new URL(draft.url);}catch{throw new Error("Enter the evidence URL.");}
      if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("Use an HTTP or HTTPS evidence URL without credentials.");
      return {reason:draft.reason,payload:{verification:draft.verdict,evidence:[{source_id:crypto.randomUUID(),kind:"url",url:draft.url,observed_at:new Date().toISOString(),retained:false}]}};
    }
    if(!draft.confirm)throw new Error("Confirm this action before submitting.");
    if(k==="knowledge.retire"){if(draft.successor&&!validGraphId(draft.successor))throw new Error("Enter a valid successor ID or leave it empty.");return {payload:{retirement_reason:draft.reason,...(draft.successor?{successor_id:draft.successor}:{})}};}
    return {reason:draft.reason,payload:{}};
  }
  async function submit(event:React.FormEvent){event.preventDefault();if(!kind||lock.current||frozen.current||!capability(kind).enabled)return;
    try{const {payload,reason}=fields(kind),value=freezeAction(kind,baseline,payload,reason);frozen.current=value;setIntent(value);setError(null);await run(value);}catch(reason){setError(reason instanceof Error?reason.message:"Review the form.");}
  }
  async function reload(){if(lock.current||!kind)return;lock.current=true;setBusy(true);
    try{const project=record.project.id;const fresh=author?adaptGraphPage(await apiGet(`${graphPath(project,"knowledge")}?limit=1`),project,"knowledge"):adaptGraphDetail(await apiGet(graphPath(project,record.data!.kind,record.data!.id)),project,record.data!.kind,record.data!.id);
      if(!current.current)return;setBaseline({project:fresh.project,...(!author?{data:fresh.data as typeof record.data}:{})});if(kind==="task.dependency.remove")await dependency.refetch();frozen.current=null;setIntent(null);setOperation(null);setRetired(false);setUnknown(false);setError(null);setDraft(v=>({...v,confirm:false}));
    }catch{if(current.current)setError("Current versions could not be loaded. Your draft is preserved.");}finally{lock.current=false;if(current.current)setBusy(false);}
  }
  const update=(name:keyof Draft,value:string|boolean)=>setDraft(v=>({...v,[name]:value,...(name==="labels"?{labelsEdited:true}:{})}));
  const editing=kind==="task.edit"||kind==="knowledge.author"||kind==="knowledge.correct";
  const status=retired?"retired":unknown?"unknown":operation?.disposition;
  return <div className={styles.actions}>
    {kinds.map(k=>{const cap=capability(k),reason=pinned?"Open the current revision to act":accessLost?"Access changed. Reload access":!cap.enabled?cap.reason:undefined;return <div className={styles.action} key={k}><ActionButton disabled={!!reason||(unsettled&&kind!==k)} title={reason} onClick={()=>launch(k)}>{actionLabels[k]}{unsettled&&kind===k?" · operation":""}</ActionButton>{reason&&<span className={styles.meta}>{reason}</span>}</div>;})}
    <dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
      <header className={styles.header}><h2 id={titleId}>{kind?actionLabels[kind]:"Action"}</h2><ActionButton onClick={()=>setOpen(false)} aria-label="Close action">Close</ActionButton></header>
      <p className={styles.meta}>{record.project.name} · {author?"Project version":"Record version"} {author?baseline.project.revision:baseline.data?.version}</p>
      {error&&<p role="alert">{error}</p>}
      {kind&&<form onSubmit={e=>void submit(e)}><fieldset className={styles.fields} disabled={busy||!!intent||accessLost}>
        {editing&&<><label>Title<input value={draft.title} required maxLength={1024} onChange={e=>update("title",e.target.value)}/></label><label>Description<textarea rows={6} value={draft.body} onChange={e=>update("body",e.target.value)}/></label>{kind==="task.edit"&&<label>Acceptance criteria<textarea rows={4} value={draft.acceptance} onChange={e=>update("acceptance",e.target.value)}/></label>}<label>Labels (comma separated)<input value={draft.labels} onChange={e=>update("labels",e.target.value)}/></label>{kind!=="task.edit"&&<label>Category<select value={draft.category} onChange={e=>update("category",e.target.value)}>{["fact","decision","policy","procedure","incident","reference","note"].map(v=><option key={v}>{v}</option>)}</select></label>}</>}
        {kind==="task.dependency.add"&&<label>Blocker task ID<input required value={draft.blocker} onChange={e=>update("blocker",e.target.value)}/></label>}
        {kind==="task.dependency.remove"&&<><label>Dependency<select required value={draft.edge} onChange={e=>update("edge",e.target.value)}><option value="">Choose a blocker</option>{dependency.data?.data.edges.filter(e=>e.target===record.data?.id&&e.edge_type==="blocks").map(e=><option key={e.id} value={e.id}>{dependency.data?.data.nodes.find(n=>n.id===e.source)?.title??e.source} · edge version {e.version}</option>)}</select></label>{dependency.isError&&<p role="alert">Dependencies unavailable. Close and reopen to check again.</p>}</>}
        {["task.cancel","knowledge.verify","knowledge.retire"].includes(kind)&&<label>Reason<textarea required rows={3} value={draft.reason} maxLength={1024} onChange={e=>update("reason",e.target.value)}/></label>}
        {kind==="knowledge.verify"&&<><label>Verification<select value={draft.verdict} onChange={e=>update("verdict",e.target.value)}><option value="verified">Verified</option><option value="disputed">Disputed</option></select></label><label>Evidence URL<input type="url" required value={draft.url} onChange={e=>update("url",e.target.value)}/></label><p className={styles.meta}>This records an assertion about this revision; it does not prove task completion.</p></>}
        {kind==="knowledge.retire"&&<label>Successor record ID (optional)<input value={draft.successor} onChange={e=>update("successor",e.target.value)}/></label>}
        {["task.cancel","knowledge.retire"].includes(kind)&&<label className={styles.confirm}><input type="checkbox" checked={draft.confirm} onChange={e=>update("confirm",e.target.checked)}/>{kind==="task.cancel"?"Confirm cancellation request. This does not prove the process stopped.":"Confirm retirement. Historical revisions remain available."}</label>}
        {kind==="task.retry"&&<p>Ask the server to assess a replacement attempt. Readiness and replacement admission are decided by the server.</p>}
      </fieldset>{!intent&&<ActionButton type="submit" disabled={busy||accessLost||!capability(kind).enabled}>Submit</ActionButton>}</form>}
      {intent&&<section className={styles.operation} aria-label="Action status"><p role="status">{status==="retired"?"Receipt details expired — the outcome is unavailable. Keep the original operation reference; do not submit it as a new operation.":status==="confirmed"?kind==="task.cancel"?"Cancellation requested":"Action confirmed":status==="conflict"?"Conflict — your draft is preserved.":status==="rejected"?"Rejected — the server did not permit this action. Review the record and permissions.":status==="pending"?"Action pending — awaiting confirmation.":"Outcome unknown — keep this operation and check its status."}</p>
        {operation?.current_versions&&Object.keys(operation.current_versions).length>0&&<p>Current versions: {Object.entries(operation.current_versions).map(([key,value])=>`${key}: ${value}`).join(", ")}</p>}
        {status==="confirmed"&&<ul aria-label="Confirmed effects">{operation?.affected_entities.map((r,i)=><li key={i}>{r.type} · {r.id}{r.revision?` · version ${r.revision}`:""}</li>)}</ul>}
        <div className={styles.footer}>{unsettled&&!retired&&<><ActionButton disabled={busy||accessLost} onClick={()=>void run(intent,true)}>Check status</ActionButton><ActionButton disabled={busy||accessLost||!kind||!capability(kind).enabled} onClick={()=>void run(intent)}>Retry exact submission</ActionButton></>}{(status==="conflict"||status==="rejected")&&<ActionButton disabled={busy||accessLost} onClick={()=>void reload()}>Reload current versions</ActionButton>}</div>
        <details className={styles.reference}><summary>Operation reference and receipts</summary><p>{intent.id}</p>{operation?.request_digest&&<p>{operation.request_digest}</p>}{operation?.receipt_refs.map((r,i)=><p key={i}>{r.type} · {r.id}{r.revision?` · version ${r.revision}`:""}</p>)}</details>
      </section>}
    </dialog>
  </div>;
}
