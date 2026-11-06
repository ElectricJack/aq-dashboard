import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Ellipsis } from "lucide-react";
import { useSession } from "../../app/session";
import { scopeSearch } from "../../app/scope";
import { ContractError } from "../../api/adapters/contract";
import { apiGet, ApiError } from "../../api/client";
import { adaptGraphDetail, adaptGraphPage, validGraphId } from "../../api/adapters/humanGraph";
import { graphPath, useGraphDetail, useGraphList, useGraphNeighborhood } from "../../api/humanGraphReads";
import { ActionButton } from "../../components/layout/Workspace";
import { actionCapability, actionLabels, actionRequest, freezeAction, knowledgeActionKinds, knowledgeCategoryLabel, type ActionContext, type ActionKind, type ActionOperation, type FrozenAction } from "./actionClient";
import { validateTitle } from "../../api/adapters/taskCreate";
import styles from "./RecordActions.module.css";

type Draft={title:string;body:string;acceptance:string;labels:string;labelsEdited:boolean;category:string;reason:string;blocker:string;blockerQuery:string;edge:string;successor:string;verdict:string;url:string;restoreRevision:string;confirm:boolean};
const CATEGORIES=["fact","decision","policy","procedure","incident","reference","note"];
/** The content revision before the current one: for a just-retired record, the last active revision. */
const previousRevision=(current:string|undefined)=>current&&/^[1-9][0-9]*$/.test(current)?String(BigInt(current)>1n?BigInt(current)-1n:1n):"";
const RESTORE_REVISION=/^[1-9][0-9]{0,15}$/;
function draftFor(record:ActionContext,author:boolean):Draft {const n=author?undefined:record.data;return {title:n?.title??"",body:n?.body??"",acceptance:n?.acceptance_criteria??"",labels:n?.labels.join(", ")??"",labelsEdited:false,category:n?.content_type??"note",reason:"",blocker:"",blockerQuery:"",edge:"",successor:"",verdict:"verified",url:"",restoreRevision:previousRevision(n?.content_revision),confirm:false};}
/** Fields the edit dialogs submit; compared field by field after a conflict reload (WDR-01). */
type EditField="title"|"body"|"acceptance"|"labels"|"category";
const EDIT_FIELD_LABEL:Record<EditField,string>={title:"Title",body:"Description",acceptance:"Acceptance criteria",labels:"Labels",category:"Category"};
const editFields=(k:ActionKind):EditField[]=>k==="task.edit"?["title","body","acceptance","labels"]:k==="knowledge.correct"?["title","body","labels","category"]:[];
const labelSet=(v:string)=>[...new Set(v.split(",").map(x=>x.trim()).filter(Boolean))].join(", ");
const fieldValue=(d:Draft,f:EditField)=>f==="labels"?labelSet(d.labels):d[f];
/** What "Reload current versions" did to the draft: fields refreshed from AQ, and fields both sides changed. */
type Rebased={version:string;refreshed:EditField[];overlapping:{field:EditField;current:string}[]};
/**
 * Three-way rebase of an edit draft onto the record AQ holds now (WDR-01; spec 0002 §10: a conflict preserves the
 * draft without overwriting newer data). Per field, against the record the draft started from:
 * - unchanged in the draft: takes AQ's current value, so a resubmission never reverts another edit;
 * - changed only in the draft: keeps the user's edit;
 * - changed in both, differently: keeps the user's edit and reports AQ's current value, which the dialog shows
 *   with "Use AQ's value", so the user decides with both values in view before resubmitting.
 * Labels edited back to the original set count as unchanged (and are again left out of the request).
 */
function rebase(draft:Draft,before:Draft,after:Draft,fields:EditField[]):{draft:Draft;refreshed:EditField[];overlapping:Rebased["overlapping"]}{
  const next={...draft},refreshed:EditField[]=[],overlapping:Rebased["overlapping"]=[];
  for(const f of fields){
    const mine=fieldValue(draft,f),was=fieldValue(before,f),now=fieldValue(after,f);
    if(mine===was||(f==="labels"&&!draft.labelsEdited)){if(now!==was)refreshed.push(f);next[f]=after[f];if(f==="labels")next.labelsEdited=false;}
    else if(now!==was&&now!==mine)overlapping.push({field:f,current:after[f]});
  }
  return {draft:next,refreshed,overlapping};
}
type Variant="default"|"compact";
/** What the task's reads say about execution; absent while unknown. `blockerIds` are the recorded blockers (work read);
 * `attempts` counts the task's recorded agent attempts (history read), absent while unknown. */
export type TaskExecutionFacts={holding:boolean;blockers:number;complete:boolean;blockerIds?:string[];attempts?:number};
/** AQ's own preconditions for the execution actions (aq-server task_execution.rs): cancel needs an attempt
 * holding the task, retry needs an active task. They are stated, never guessed beyond what the reads show. */
function executionReason(k:ActionKind,state:string|null|undefined,execution?:TaskExecutionFacts):string|undefined{
  if(k==="task.cancel"){if(state&&state!=="active")return `No agent attempt can hold a ${state} task`;if(execution&&!execution.holding)return "No agent attempt holds this task";}
  if(k==="task.retry"&&state&&state!=="active")return "AQ retries attempts of active tasks only";
  // Retry replaces the task's last attempt (B4); with none recorded AQ always refuses it (WD-11).
  if(k==="task.retry"&&execution?.attempts===0)return "This task has never had an agent attempt to retry";
  if(k==="task.dependency.remove"&&execution?.complete&&execution.blockers===0)return "This task has no recorded blockers";
  return undefined;
}
/** `kinds` narrows the offered actions (for example to those a compact header can show); it never adds kinds. */
export function RecordActions(props:{record:ActionContext;author?:boolean;pinned?:string;kinds?:ActionKind[];variant?:Variant;execution?:TaskExecutionFacts}) {
  const {queryContext}=useSession();
  return <Actions key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.record.project.id}:${props.author?"author":props.record.data?.id}`} {...props}/>;
}
function Actions({record,author=false,pinned,kinds:only,variant="default",execution}:{record:ActionContext;author?:boolean;pinned?:string;kinds?:ActionKind[];variant?:Variant;execution?:TaskExecutionFacts}) {
  const {bootstrap,queryContext,reportAccessDenied,reportIncompatible}=useSession();const cache=useQueryClient();
  const kinds:ActionKind[]=(author?["knowledge.author"] as ActionKind[]:record.data?.kind==="task"?["task.edit","task.cancel","task.retry","task.dependency.add","task.dependency.remove"] as ActionKind[]:knowledgeActionKinds(record.data)).filter(k=>!only||only.includes(k));
  const [kind,setKind]=useState<ActionKind|null>(null),[open,setOpen]=useState(false),[draft,setDraft]=useState(()=>draftFor(record,author));
  const [baseline,setBaseline]=useState(record),[intent,setIntent]=useState<FrozenAction|null>(null),[operation,setOperation]=useState<ActionOperation|null>(null);
  const [retired,setRetired]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[accessLost,setAccessLost]=useState(false);
  const [rebased,setRebased]=useState<Rebased|null>(null),[refusal,setRefusal]=useState<number|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),lock=useRef(false),current=useRef(true),controller=useRef<AbortController|null>(null),frozen=useRef<FrozenAction|null>(null);
  const blockerIds=new Set((execution?.blockerIds??[]).map(id=>id.toLowerCase()));
  const dependency=useGraphNeighborhood(kind==="task.dependency.remove"?record.project.id:"",record.data?.id??"");
  // Add dependency: pick the blocker by title (the project task search) or paste its ID (WD-09).
  const [blockerSearch,setBlockerSearch]=useState("");
  useEffect(()=>{const q=draft.blockerQuery.trim();const t=setTimeout(()=>setBlockerSearch(q.length>=2&&!validGraphId(String(q))?q.slice(0,256):""),250);return()=>clearTimeout(t);},[draft.blockerQuery]);
  const candidates=useGraphList(kind==="task.dependency.add"&&blockerSearch?record.project.id:"","task",blockerSearch);
  // Restore previews the chosen revision so a retired target is caught before submission.
  const restoreRevision=draft.restoreRevision.trim(),restoreValid=RESTORE_REVISION.test(restoreRevision)&&Number.isSafeInteger(Number(restoreRevision));
  const restoreTarget=useGraphDetail(kind==="knowledge.restore"&&open&&restoreValid?record.project.id:"","knowledge",record.data?.id??"",restoreValid?restoreRevision:undefined);
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
      if(next.disposition==="confirmed")await cache.invalidateQueries({predicate:q=>q.queryKey[0]==="aq"&&q.queryKey[1]===queryContext.principalId&&["human-graph-list","human-graph-detail","human-graph-neighborhood","human-graph-task-work","human-graph-task-attempts","overview-task-contributions"].includes(String(q.queryKey[4]))});
    }catch(reason){if(!current.current)return;
      if(reason instanceof ApiError&&reason.status===401){setAccessLost(true);setDraft(draftFor({project:record.project},true));setOperation(null);reportAccessDenied(reason);setError("Access changed. Reload access before checking the operation.");}
      // A 403 refuses this one request (SO-03, ISSUE-003): the dialog and its draft stay; a resubmission gets a new operation identity.
      else if(reason instanceof ApiError&&reason.status===403){reportAccessDenied(reason);if(lookup)setAccessLost(true);else{frozen.current=null;setIntent(null);setOperation(null);}setUnknown(false);setError(`AQ refused this ${lookup?"status check":"action"}.${reason.envelope?.message?` ${reason.envelope.message}.`:""}${lookup?"":" Nothing was changed. Your draft is preserved."}`);}
      else if(reason instanceof ApiError&&reason.status===426){reportIncompatible("dashboard.actions");setUnknown(true);}
      else if(reason instanceof ApiError&&reason.status===410){setRetired(true);setUnknown(false);setError(null);}
      else if(!lookup&&reason instanceof ApiError&&reason.status===409){setOperation({operation_id:value.id,disposition:"conflict",request_digest:"",subject_refs:[],receipt_refs:[],affected_entities:[],current_versions:reason.envelope?.current_versions,recovery:"refresh_and_review"});setUnknown(false);setError(reason.envelope?.message??"The expected version has changed.");}
      else if(!lookup&&reason instanceof ApiError&&!reason.effectUnknown&&[400,404,413,422].includes(reason.status??0)){setOperation({operation_id:value.id,disposition:"rejected",request_digest:"",subject_refs:[],receipt_refs:[],affected_entities:[],recovery:"refresh_and_review"});setUnknown(false);setRefusal(reason.status??null);
        // The only task a dependency names besides the subject is the blocker: a 404 means it doesn't exist or isn't visible (WDR-05).
        setError(value.kind==="task.dependency.add"&&reason.status===404?"The blocker task doesn't exist or isn't available to you. Check the task ID, or choose the blocker from the matching tasks.":reason.envelope?.message??"AQ refused this action.");}
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
    frozen.current=null;setIntent(null);setOperation(null);setRetired(false);setUnknown(false);setError(null);setRebased(null);setRefusal(null);setBaseline(record);setDraft(draftFor(record,author));setKind(k);setOpen(true);
  }
  function fields(k:ActionKind):{payload:Record<string,unknown>;reason?:string}{
    if(["task.edit","knowledge.author","knowledge.correct"].includes(k)){
      const labels=k==="knowledge.author"||draft.labelsEdited?[...new Set(draft.labels.split(",").map(x=>x.trim()).filter(Boolean))]:undefined;
      if(labels&&(labels.length>16||labels.some(v=>new TextEncoder().encode(v).length>128)))throw new Error("Use at most 16 labels, each up to 128 bytes.");
      const titleProblem=validateTitle(draft.title,"bytes");if(titleProblem)throw new Error(titleProblem);
      if(new TextEncoder().encode(draft.body).length>32768||new TextEncoder().encode(draft.acceptance).length>8192)throw new Error("Shorten the description or acceptance criteria.");
      return {payload:{title:draft.title,body:draft.body,...(labels?{labels}:{}),...(k==="task.edit"?{acceptance_criteria:draft.acceptance}:{content_type:draft.category})}};
    }
    if(k==="task.dependency.add"){if(!validGraphId(draft.blocker))throw new Error("Choose the blocker from the matching tasks, or paste its task ID.");if(draft.blocker.toLowerCase()===record.data?.id.toLowerCase())throw new Error("A task can't block itself. Choose another task.");if(blockerIds.has(draft.blocker.toLowerCase()))throw new Error("That task already blocks this one. Choose another task.");return {payload:{blocker_id:draft.blocker}};}
    if(k==="task.dependency.remove"){const edge=dependency.data?.data.edges.find(e=>e.id===draft.edge&&e.target===record.data?.id&&e.edge_type==="blocks");if(!edge)throw new Error("Choose a recorded dependency.");return {payload:{edge_id:edge.id,edge_version:edge.version}};}
    if(k==="task.retry")return {payload:{}};
    if(k==="knowledge.restore"){
      if(!restoreValid)throw new Error("Enter the content revision to restore.");
      const current=baseline.data?.content_revision;
      if(current&&BigInt(restoreRevision)>=BigInt(current))throw new Error(`Choose a revision earlier than the current revision ${current}.`);
      const target=restoreTarget.data?.data;
      if(target&&(target.retired||target.deleted))throw new Error(`Revision ${restoreRevision} is also ${target.deleted?"deleted":"retired"}. Choose an earlier active revision.`);
      if(new TextEncoder().encode(draft.reason).length>1024)throw new Error("Enter a reason of at most 1024 bytes.");
      if(!draft.confirm)throw new Error("Confirm this action before submitting.");
      return {...(draft.reason.trim()?{reason:draft.reason}:{}),payload:{revision:Number(restoreRevision),include_lifecycle:true}};
    }
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
    try{const {payload,reason}=fields(kind),value=freezeAction(kind,baseline,payload,reason);frozen.current=value;setIntent(value);setError(null);setRebased(null);setRefusal(null);await run(value);}catch(reason){setError(reason instanceof Error?reason.message:"Review the form.");}
  }
  async function reload(){if(lock.current||!kind)return;lock.current=true;setBusy(true);
    try{const project=record.project.id;const fresh=author?adaptGraphPage(await apiGet(`${graphPath(project,"knowledge")}?limit=1`),project,"knowledge"):adaptGraphDetail(await apiGet(graphPath(project,record.data!.kind,record.data!.id)),project,record.data!.kind,record.data!.id);
      if(!current.current)return;const next:ActionContext={project:fresh.project,...(!author?{data:fresh.data as typeof record.data}:{})};
      // Untouched fields take AQ's current values; the user's own edits stay (WDR-01, see rebase()).
      const fields=editFields(kind),merged=fields.length?rebase(draft,draftFor(baseline,false),draftFor(next,false),fields):null;
      setBaseline(next);if(kind==="task.dependency.remove")await dependency.refetch();frozen.current=null;setIntent(null);setOperation(null);setRetired(false);setUnknown(false);setError(null);setRefusal(null);
      setDraft(v=>({...(merged?merged.draft:v),confirm:false}));setRebased(merged&&next.data?{version:next.data.version,refreshed:merged.refreshed,overlapping:merged.overlapping}:null);
    }catch{if(current.current)setError("Current versions could not be loaded. Your draft is preserved.");}finally{lock.current=false;if(current.current)setBusy(false);}
  }
  const update=(name:keyof Draft,value:string|boolean)=>setDraft(v=>({...v,[name]:value,...(name==="labels"?{labelsEdited:true}:{}),
    // A pasted task ID is the blocker; any other text searches titles and clears the previous choice.
    ...(name==="blockerQuery"?{blocker:validGraphId(String(value).trim())?String(value).trim():""}:{})}));
  const editing=kind==="task.edit"||kind==="knowledge.author"||kind==="knowledge.correct";
  const status=retired?"retired":unknown?"unknown":operation?.disposition;
  const reasonFor=(k:ActionKind)=>{const cap=capability(k);return pinned?"Open the current revision to act":accessLost?"Access changed. Reload access":!cap.enabled?cap.reason:record.data?.kind==="task"?executionReason(k,record.data.task_state,execution):undefined;};
  // A confirmed author operation creates the record under the operation ID; link straight to it.
  const created=kind==="knowledge.author"&&status==="confirmed"&&intent?operation?.affected_entities.find(r=>r.type==="knowledge"&&validGraphId(r.id))?.id??(validGraphId(intent.id)?intent.id:undefined):undefined;
  const target=restoreTarget.data?.data;
  const restorePreview=!restoreValid?"Enter an earlier content revision.":restoreTarget.isError?`Revision ${restoreRevision} could not be read. The server checks it when you submit.`:!target?`Reading revision ${restoreRevision}…`:
    `Revision ${restoreRevision}: “${target.title}” · ${target.deleted?"Deleted":target.retired?"Retired — choose an earlier revision":"Active"}`;
  return <div className={variant==="compact"?styles.compact:styles.actions}>
    {variant==="compact"?<CompactActions kinds={kinds} reasonFor={reasonFor} taskState={record.data?.kind==="task"?record.data.task_state:undefined} pending={unsettled?kind:null} launch={launch}/>:
    kinds.map(k=>{const reason=reasonFor(k)??(unsettled&&kind!==k?"Settle the current operation first":undefined),hint=`${titleId}-${k}-reason`;return <div className={styles.action} key={k}><ActionButton disabled={!!reason} title={reason} aria-describedby={reason?hint:undefined} onClick={()=>launch(k)}>{actionLabels[k]}{unsettled&&kind===k?" · operation":""}</ActionButton>{reason&&<span id={hint} className={styles.meta}>{reason}</span>}</div>;})}
    <dialog className={styles.dialog} ref={dialog} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();setOpen(false);}} onClose={()=>setOpen(false)}>
      <header className={styles.header}><h2 id={titleId}>{kind?actionLabels[kind]:"Action"}</h2><ActionButton onClick={()=>setOpen(false)} aria-label="Close action">Close</ActionButton></header>
      <p className={styles.meta}>{record.project.name} · {author?"Project version":"Record version"} {author?baseline.project.revision:baseline.data?.version}</p>
      {error&&<p role="alert">{error}</p>}
      {rebased&&!intent&&editing&&<RebaseNotice rebased={rebased} draft={draft} onUseCurrent={(field,value)=>{setDraft(v=>({...v,[field]:value,...(field==="labels"?{labelsEdited:true}:{})}));setRebased(r=>r&&{...r,overlapping:r.overlapping.filter(o=>o.field!==field)});}}/>}
      {kind&&<form onSubmit={e=>void submit(e)}><fieldset className={styles.fields} disabled={busy||!!intent||accessLost}>
        {editing&&<><label>Title<input value={draft.title} required maxLength={512} onChange={e=>update("title",e.target.value)}/></label><label>Description<textarea rows={6} value={draft.body} onChange={e=>update("body",e.target.value)}/></label>{kind==="task.edit"&&<label>Acceptance criteria<textarea rows={4} value={draft.acceptance} onChange={e=>update("acceptance",e.target.value)}/></label>}<label>Labels (comma separated)<input value={draft.labels} onChange={e=>update("labels",e.target.value)}/></label>{kind!=="task.edit"&&<label>Category<select value={draft.category} onChange={e=>update("category",e.target.value)}>{(CATEGORIES.includes(draft.category)?CATEGORIES:[...CATEGORIES,draft.category]).map(v=><option key={v} value={v}>{knowledgeCategoryLabel(v)}</option>)}</select></label>}</>}
        {kind==="task.dependency.add"&&<BlockerPicker query={draft.blockerQuery} blocker={draft.blocker} self={record.data?.id} existing={blockerIds} search={blockerSearch} candidates={candidates} onQuery={v=>update("blockerQuery",v)} onPick={id=>update("blocker",id)}/>}
        {kind==="task.dependency.remove"&&<><label>Dependency<select required value={draft.edge} onChange={e=>update("edge",e.target.value)}><option value="">Choose a blocker</option>{dependency.data?.data.edges.filter(e=>e.target===record.data?.id&&e.edge_type==="blocks").map(e=><option key={e.id} value={e.id}>{dependency.data?.data.nodes.find(n=>n.id===e.source)?.title??e.source} · edge version {e.version}</option>)}</select></label>{dependency.isError&&<p role="alert">Dependencies unavailable. Close and reopen to check again.</p>}</>}
        {["task.cancel","knowledge.verify","knowledge.retire"].includes(kind)&&<label>Reason<textarea required rows={3} value={draft.reason} maxLength={1024} onChange={e=>update("reason",e.target.value)}/></label>}
        {kind==="knowledge.verify"&&<><label>Verification<select value={draft.verdict} onChange={e=>update("verdict",e.target.value)}><option value="verified">Verified</option><option value="disputed">Disputed</option></select></label><label>Evidence URL<input type="url" required value={draft.url} onChange={e=>update("url",e.target.value)}/></label><p className={styles.meta}>This records an assertion about this revision; it does not prove task completion.</p></>}
        {kind==="knowledge.retire"&&<label>Successor record ID (optional)<input value={draft.successor} onChange={e=>update("successor",e.target.value)}/></label>}
        {kind==="knowledge.restore"&&<><p>Restores the content and active lifecycle of an earlier content revision as a new revision. The retirement stays in the record's history.</p>
          <label>Content revision to restore<input required inputMode="numeric" maxLength={16} value={draft.restoreRevision} onChange={e=>update("restoreRevision",e.target.value)}/></label>
          <p className={styles.meta} aria-live="polite">{restorePreview}</p>
          <label>Reason (optional)<textarea rows={3} value={draft.reason} maxLength={1024} onChange={e=>update("reason",e.target.value)}/></label></>}
        {["task.cancel","knowledge.retire","knowledge.restore"].includes(kind)&&<label className={styles.confirm}><input type="checkbox" checked={draft.confirm} onChange={e=>update("confirm",e.target.checked)}/>{kind==="task.cancel"?"Confirm cancellation request. This does not prove the process stopped.":kind==="knowledge.restore"?"Confirm restore. Verification resets to unverified on the new revision.":"Confirm retirement. Historical revisions remain available."}</label>}
        {kind==="task.cancel"&&<p className={styles.meta}>Cancels the agent attempt holding this task. The task itself stays {record.data?.task_state??"in its current state"}; AQ refuses the request when no attempt holds it.</p>}
        {kind==="task.retry"&&<p>Ask AQ to start a replacement for this task's last agent attempt. AQ decides whether a replacement is admissible; the task's lifecycle doesn't change.</p>}
      </fieldset>{!intent&&<ActionButton type="submit" disabled={busy||accessLost||!capability(kind).enabled}>Submit</ActionButton>}</form>}
      {intent&&<section className={styles.operation} aria-label="Action status"><p role="status">{status==="retired"?"Receipt details expired — the outcome is unavailable. Keep the original operation reference; do not submit it as a new operation.":status==="confirmed"?kind==="task.cancel"?"Cancellation requested":"Action confirmed":status==="conflict"?"Conflict — your draft is preserved.":status==="rejected"?`Rejected — AQ refused this action.${kind&&REFUSAL_HINT[kind]&&!(kind==="task.dependency.add"&&refusal===404)?` ${REFUSAL_HINT[kind]}`:""}`:status==="pending"?"Action pending — awaiting confirmation.":"Outcome unknown — keep this operation and check its status."}</p>
        {operation?.current_versions&&Object.keys(operation.current_versions).length>0&&<p>Current versions: {Object.entries(operation.current_versions).map(([key,value])=>`${key}: ${value}`).join(", ")}</p>}
        {status==="confirmed"&&<ul aria-label="Confirmed effects">{operation?.affected_entities.map((r,i)=><li key={i}>{r.type} · {r.id}{r.revision?` · version ${r.revision}`:""}</li>)}</ul>}
        {created&&<p><Link to={{pathname:`/knowledge/${encodeURIComponent(created)}`,search:scopeSearch({kind:"project",project_id:record.project.id})}} onClick={()=>setOpen(false)}>Open new record</Link></p>}
        <div className={styles.footer}>{unsettled&&!retired&&<><ActionButton disabled={busy||accessLost} onClick={()=>void run(intent,true)}>Check status</ActionButton><ActionButton disabled={busy||accessLost||!kind||!capability(kind).enabled} onClick={()=>void run(intent)}>Retry exact submission</ActionButton></>}{(status==="conflict"||status==="rejected")&&<ActionButton disabled={busy||accessLost} onClick={()=>void reload()}>Reload current versions</ActionButton>}</div>
        <details className={styles.reference}><summary>Operation reference and receipts</summary><p>{intent.id}</p>{operation?.request_digest&&<p>{operation.request_digest}</p>}{operation?.receipt_refs.map((r,i)=><p key={i}>{r.type} · {r.id}{r.revision?` · version ${r.revision}`:""}</p>)}</details>
      </section>}
    </dialog>
  </div>;
}

const NOT_OFFERED="Not offered by this AQ server";
/** The dashboard actions contract carries no rejection reason (WD-08); restate the server's preconditions instead. */
const REFUSAL_HINT:Partial<Record<ActionKind,string>>={
  "task.cancel":"It cancels only an agent attempt that holds this task.",
  "task.retry":"It retries only an active task whose last attempt can be replaced.",
  // AQ accepts a repeated dependency as a no-op; a cycle (or another Graph rule) is what it refuses (WDR-05).
  "task.dependency.add":"AQ refuses a dependency that would create a cycle, for example when this task already blocks the chosen one.",
};

/** After a conflict reload: what came from AQ, and AQ's value for each field both sides changed (WDR-01). */
function RebaseNotice({rebased,draft,onUseCurrent}:{rebased:Rebased;draft:Draft;onUseCurrent:(field:EditField,value:string)=>void}){
  const names=(fields:EditField[])=>fields.map(f=>EDIT_FIELD_LABEL[f]).join(", ");
  return <section className={styles.rebase} aria-label="Reloaded record" aria-live="polite">
    <p>Reloaded record version {rebased.version}. {rebased.refreshed.length?`Updated from AQ: ${names(rebased.refreshed)}.`:"AQ changed none of the fields you left alone."} Your own edits are kept.</p>
    {rebased.overlapping.map(({field,current})=>fieldValue(draft,field)===(field==="labels"?labelSet(current):current)?null:<div key={field} className={styles.overlap}>
      <p><strong>{EDIT_FIELD_LABEL[field]}</strong> was also changed in AQ. Your edit is kept; submitting replaces AQ's value:</p>
      <p className={styles.current}>{current||"(empty)"}</p>
      <ActionButton onClick={()=>onUseCurrent(field,current)}>Use AQ's {EDIT_FIELD_LABEL[field].toLowerCase()}</ActionButton>
    </div>)}
  </section>;
}

/** Blocker by title search or pasted ID; results come from the project's task search read. */
function BlockerPicker({query,blocker,self,existing,search,candidates,onQuery,onPick}:{query:string;blocker:string;self?:string;existing:Set<string>;search:string;candidates:ReturnType<typeof useGraphList>;onQuery:(v:string)=>void;onPick:(id:string)=>void}){
  const hint=useId(),legend=useId();
  const rows=(candidates.data?.pages.flatMap(p=>p.data.items)??[]).filter(n=>n.id!==self).slice(0,8);
  const pasted=validGraphId(query.trim()),already=pasted&&existing.has(query.trim().toLowerCase());
  return <>
    <label>Blocker task<input type="search" required={!blocker} value={query} maxLength={256} placeholder="Search by title or paste a task ID" aria-describedby={hint} onChange={e=>onQuery(e.target.value)}/></label>
    <span id={hint} className={styles.meta}>{already?`Task ${query.trim()} already blocks this task.`:pasted?`Blocker: task ${query.trim()}`:"Type at least two characters of the blocker's title."}</span>
    {!pasted&&search&&(candidates.isError?<p role="alert" className={styles.meta}>Task search unavailable. Paste the blocker's task ID instead.</p>
      :!candidates.data?<p role="status" className={styles.meta}>Searching tasks…</p>
      :rows.length?<fieldset className={styles.choices} aria-labelledby={legend}><legend id={legend}>Matching tasks</legend>{rows.map(n=>{const blocks=existing.has(n.id.toLowerCase());return <label key={n.id} className={styles.choice}>
        {/* A task that already blocks this one is shown, not offered (WDR-05). */}
        <input type="radio" name="blocker" value={n.id} checked={blocker===n.id} disabled={blocks} onChange={()=>onPick(n.id)}/><span>{n.title}<span className={styles.meta}> · {blocks?"already blocks this task":n.task_state??"task"} · {n.id.slice(0,8)}</span></span>
      </label>;})}</fieldset>
      :<p role="status" className={styles.meta}>No other tasks match “{search}”.</p>)}
  </>;
}
// The single most relevant action for a task's recorded state; cancellation is never promoted.
function preferredFor(kinds:ActionKind[],taskState:string|null|undefined):ActionKind[] {
  if(taskState===undefined)return kinds;
  return taskState==="canceled"||taskState==="completed"?[]:["task.edit"];
}
/** One primary action plus a "More actions" menu; one shared reason when nothing is offered. */
function CompactActions({kinds,reasonFor,taskState,pending,launch}:{kinds:ActionKind[];reasonFor:(k:ActionKind)=>string|undefined;taskState:string|null|undefined;pending:ActionKind|null;launch:(k:ActionKind)=>void}) {
  const [open,setOpen]=useState(false),menuId=useId(),container=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null);
  const reasons=new Map(kinds.map(k=>[k,reasonFor(k)]));
  const available=kinds.filter(k=>!reasons.get(k));
  const primary=pending&&kinds.includes(pending)?pending:preferredFor(kinds,taskState).find(k=>available.includes(k));
  const rest=kinds.filter(k=>k!==primary);
  const items=()=>[...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]")??[])];
  useEffect(()=>{if(!open)return;items()[0]?.focus({preventScroll:true});menu.current?.scrollIntoView?.({block:"nearest"});},[open]);
  if(!available.length&&!pending){
    const reason=kinds.map(k=>reasons.get(k)).find(Boolean),noun=taskState===undefined?"Actions":"Task actions";
    return <p className={styles.unavailable} role="note">{reason===NOT_OFFERED?`${noun} aren't offered by this AQ server`:`${noun} unavailable · ${reason}`}</p>;
  }
  const close=(focus=true)=>{setOpen(false);if(focus)container.current?.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")?.focus();};
  const choose=(k:ActionKind)=>{if(reasons.get(k)||(pending&&pending!==k))return;close(false);launch(k);};
  const label=(k:ActionKind)=>`${actionLabels[k]}${pending===k?" · operation":""}`;
  return <>
    {primary&&<ActionButton className={styles.primary} disabled={!!reasons.get(primary)} onClick={()=>launch(primary)}>{label(primary)}</ActionButton>}
    {rest.length>0&&<div ref={container} className={styles.more} onBlur={e=>{if(open&&!e.currentTarget.contains(e.relatedTarget as Node|null))setOpen(false);}} onKeyDown={e=>{
      if(!open)return;
      if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==="Tab"){setOpen(false);return;}
      const list=items(),at=list.indexOf(document.activeElement as HTMLElement);
      const next=e.key==="ArrowDown"?at+1:e.key==="ArrowUp"?at-1:e.key==="Home"?0:e.key==="End"?list.length-1:null;
      if(next===null||!list.length)return;e.preventDefault();list[(next+list.length)%list.length]?.focus();
    }}>
      <ActionButton aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} onClick={()=>setOpen(v=>!v)}><Ellipsis size={18} aria-hidden/>More actions</ActionButton>
      {open&&<div ref={menu} id={menuId} role="menu" aria-label="More actions" className={styles.menu}>
        {rest.map(k=>{const reason=reasons.get(k)??(pending&&pending!==k?"Settle the current operation first":undefined),hint=`${menuId}-${k}`;return <button key={k} type="button" role="menuitem" tabIndex={-1} className={styles.menuItem} aria-disabled={reason?true:undefined} aria-describedby={reason?hint:undefined} onClick={()=>choose(k)}>
          <span>{label(k)}</span>{reason&&<span id={hint} className={styles.meta}>{reason===NOT_OFFERED?"Not offered":reason}</span>}
        </button>;})}
      </div>}
    </div>}
  </>;
}
