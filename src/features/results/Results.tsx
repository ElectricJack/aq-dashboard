import {useEffect,useRef,useState} from "react";
import {useInfiniteQuery} from "@tanstack/react-query";
import {Link,useParams,useSearchParams} from "react-router";
import {apiGet} from "../../api/client";
import {adaptResultsFeed,adaptResultDetail,adaptResultComments,mediaBinding,validateResultPayload,type ResultDetail} from "../../api/adapters/resultsFeedback";
import {ContractError} from "../../api/adapters/contract";
import {scopedKey} from "../../api/queryKeys";
import type {Scope} from "../../api/wire/proposed";
import {useSession} from "../../app/session";
import {scopeSearch,useScope} from "../../app/scope";
import {useProjects} from "../../app/useProjects";
import {ScopePicker} from "../../components/ScopePicker";
import {QueryStatus} from "../../components/QueryStatus/QueryStatus";
import {ActionButton} from "../../components/layout/Workspace";
import {ResultMedia,ResultMediaWindow,resultMediaKey} from "./ResultMedia";
import {ResultMediaUpload} from "./ResultMediaUpload";
import {ResultDiscussion,CommentView} from "./ResultDiscussion";
import {FeedbackDraft} from "./FeedbackDraft";
import {OperationStatus,useResultOperation} from "./useResultOperation";
import styles from "./Results.module.css";
const modes=[['latest','Latest'],['needs_review','Needs review'],['following','Following']] as const;
const reading=new Map<string,number>();
function useComments(detail?:ResultDetail){
 const {queryContext}=useSession();
 return useInfiniteQuery({queryKey:scopedKey(queryContext,detail?{kind:"project",project_id:detail.result.project_id}:{kind:"all_authorized"},"result-comments",{id:detail?.result.id,revision:detail?.revision.revision}),enabled:!!detail,initialPageParam:null as string|null,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:false,
  queryFn:async({pageParam,signal})=>{const p=new URLSearchParams({limit:"20"});if(pageParam)p.set("cursor",pageParam);return adaptResultComments(await apiGet<unknown>(`/api/v1/results/${detail!.result.id}/revisions/${detail!.revision.revision}/comments?${p}`,signal),detail!.result.project_id);},getNextPageParam:(last,pages)=>pages.length<4?last.next_cursor??undefined:undefined});
}
export function Results(){
 const [scope]=useScope(),[params]=useSearchParams(),{resultId,revision}=useParams(),{queryContext,bootstrap}=useSession();
 if(!bootstrap.capability("results.read").enabled)return <p>{capReason(bootstrap.capability("results.read"))}</p>;
 return <Feed key={JSON.stringify([queryContext,scope,resultId,revision,params.get("mode"),params.get("task"),params.get("media"),params.get("since"),params.get("until")])} scope={scope}/>;
}
function Feed({scope}:{scope:Scope}){
 const {queryContext}=useSession(),{resultId,revision}=useParams(),[params,setParams]=useSearchParams(),[,setScope]=useScope(),projects=useProjects();
 const mode=modes.some(([value])=>value===params.get("mode"))?params.get("mode")!:"latest",project=scope.kind==="project"?scope.project_id:undefined;
 const exact=resultId&&revision?{id:resultId,revision}:undefined;
 const task=params.get("task")??"",media=params.get("media")??"any",since=params.get("since")??"",until=params.get("until")??"";
 const [selected,setSelected]=useState<string|null>(null),[panelOpen,setPanelOpen]=useState(true),[sheet,setSheet]=useState(false),[drafts,setDrafts]=useState<{detail:ResultDetail;comment?:string;open:boolean}[]>([]),[arrivals,setArrivals]=useState(false),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState<string|null>(null);
 const key=JSON.stringify([queryContext,scope,resultId,revision,mode,task,media,since,until]),restored=useRef(false),active=useRef(true),probe=useRef<AbortController|null>(null);
 const filterParams=()=>{const p=new URLSearchParams({mode,scope:scope.kind,media:["any","image","none"].includes(media)?media:"any",limit:"10"});if(project)p.set("project_id",project);if(task)p.set("task_id",task);if(since)p.set("since_ms",String(new Date(since).getTime()));if(until)p.set("until_ms",String(new Date(until).getTime()));return p;};
 const query=useInfiniteQuery({queryKey:scopedKey(queryContext,scope,"result-feed",{resultId,revision,mode,task,media,since,until}),initialPageParam:null as string|null,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:false,
  queryFn:async({pageParam,signal})=>{const p=filterParams();if(pageParam)p.set("cursor",pageParam);if(exact){const raw=await apiGet<unknown>(`/api/v1/results/${exact.id}/revisions/${exact.revision}${project?`?project_id=${project}`:""}`,signal);return {items:[adaptResultDetail(raw,exact,project)],next_cursor:null};}return adaptResultsFeed(await apiGet<unknown>(`/api/v1/results?${p}`,signal),scope);},getNextPageParam:(last,pages)=>!exact&&pages.length<4?last.next_cursor??undefined:undefined});
 const items=query.data?.pages.flatMap(p=>p.items)??[];
 useEffect(()=>{const id=params.get("feedback_operation"),result=params.get("feedback_result"),revision=params.get("feedback_revision");if(!id||drafts.some(d=>d.detail.result.id===result&&d.detail.revision.revision===revision))return;const detail=items.find(i=>i.result.id===result&&i.revision.revision===revision);if(detail)openDraft(detail);});
 const current=items.find(i=>i.result.id===selected)??items[0],comments=useComments(current);
 useEffect(()=>{active.current=true;return()=>{active.current=false;probe.current?.abort();reading.set(key,window.scrollY);if(reading.size>16)reading.delete(reading.keys().next().value!);};},[key]);
 useEffect(()=>{if(query.data&&!restored.current){restored.current=true;const y=reading.get(key);if(y!==undefined)requestAnimationFrame(()=>window.scrollTo(0,y));}},[query.data,key]);
 async function check(){if(checking||exact)return;setChecking(true);setCheckError(null);const controller=new AbortController();probe.current=controller;try{const page=adaptResultsFeed(await apiGet<unknown>(`/api/v1/results?${filterParams()}`,controller.signal),scope);if(active.current)setArrivals(JSON.stringify(page.items.map(i=>[i.result.id,i.revision.revision]))!==JSON.stringify(query.data?.pages[0]?.items.map(i=>[i.result.id,i.revision.revision])));}catch{if(active.current)setCheckError("Could not check for new results.");}finally{if(active.current)setChecking(false);}}
 useEffect(()=>{if(exact)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")void check();},60000);return()=>clearInterval(timer);});
 function openDraft(detail:ResultDetail,comment?:string){setDrafts(old=>old.some(d=>d.detail.result.id===detail.result.id&&d.detail.revision.revision===detail.revision.revision)?old.map(d=>({...d,open:d.detail.result.id===detail.result.id&&d.detail.revision.revision===detail.revision.revision})):[...old.map(d=>({...d,open:false})),{detail,comment,open:true}]);}
 function update(name:string,value:string){setParams(old=>{const next=new URLSearchParams(old);if(value)next.set(name,value);else next.delete(name);return next;});}
 if(!query.data||query.isError)return <QueryStatus status={query.isError?"error":"pending"} error={query.error} label="results" onRetry={()=>void query.refetch()}/>;
 if(new Set(items.map(i=>i.result.id)).size!==items.length)throw new ContractError("Result snapshot contains duplicate identities");
 return <ResultMediaWindow keys={items.map(i=>resultMediaKey(mediaBinding(i)))}><div className={styles.layout}>
  <div className={styles.toolbar}>{exact?<Link to={{pathname:"/results",search:scopeSearch(scope)}}>Back to results</Link>:<div role="tablist" aria-label="Result feed mode" className={styles.tabs}>{modes.map(([value,label])=><button key={value} role="tab" aria-selected={mode===value} onClick={()=>update("mode",value)}>{label}</button>)}</div>}<ScopePicker scope={scope} onChange={setScope} projects={projects.data?.view??[]}/></div>
  {!exact&&<div className={styles.filterbar}><details className={styles.filters}><summary>Filters</summary><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);setParams(old=>{const next=new URLSearchParams(old);for(const name of ["task","media","since","until"]){const value=String(data.get(name)??"");if(value)next.set(name,value);else next.delete(name);}return next;});}}><label>Task ID<input name="task" defaultValue={task}/></label><label>Media<select name="media" defaultValue={media}><option value="any">Any media</option><option value="image">Images</option><option value="none">No media</option></select></label><label>Submitted from<input type="datetime-local" name="since" defaultValue={since}/></label><label>Submitted through<input type="datetime-local" name="until" defaultValue={until}/></label><ActionButton type="submit">Apply filters</ActionButton></form></details><ActionButton disabled={checking} onClick={()=>void check()}>Check for new results</ActionButton></div>}
  {checkError&&<p role="status">{checkError}</p>}{arrivals&&<ActionButton className={styles.arrivals} onClick={()=>{setArrivals(false);void query.refetch();}}>New results available</ActionButton>}
  <div className={styles.columns}><div className={styles.feedColumn}>{items.length?<ul className={styles.feed} aria-label="Results feed">{items.map(item=><li key={`${item.result.id}:${item.revision.revision}`}><ResultCard detail={item} selected={current?.result.id===item.result.id} select={()=>{setSelected(item.result.id);setPanelOpen(true);}} openComments={()=>{setSelected(item.result.id);setSheet(true);}} feedback={()=>{setSelected(item.result.id);openDraft(item);}}/></li>)}</ul>:<div className={styles.empty}>No results in this scope and filter.</div>}
   {query.hasNextPage&&<ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more</ActionButton>}{query.data.pages.length===4&&query.data.pages.at(-1)?.next_cursor&&<p>Showing 40 results. Narrow the filters to read more.</p>}
  </div>{current&&panelOpen&&<ResultDiscussion key={`${current.result.id}:${current.revision.revision}`} detail={current} query={comments} onClose={()=>setPanelOpen(false)} onFeedback={id=>openDraft(current,id)}/>}</div>
  {sheet&&current&&<ResultDiscussion key={`sheet:${current.result.id}`} detail={current} query={comments} sheet onClose={()=>setSheet(false)} onFeedback={id=>openDraft(current,id)}/>}
  {drafts.map(draft=><RetainedDraft key={`${draft.detail.result.id}:${draft.detail.revision.revision}`} draft={draft} onClose={()=>setDrafts(old=>old.map(d=>d===draft?{...d,open:false}:d))}/>)}
 </div></ResultMediaWindow>;
}
function RetainedDraft({draft,onClose}:{draft:{detail:ResultDetail;comment?:string;open:boolean};onClose():void}){const comments=useComments(draft.detail);return <FeedbackDraft detail={draft.detail} comments={comments.data?.pages.flatMap(p=>p.items)??[]} initial={draft.comment} open={draft.open} onClose={onClose} onRefresh={async()=>{const next=await comments.refetch();if(next.error)throw next.error;return next.data?.pages.flatMap(p=>p.items)??[];}}/>;}
function ResultCard({detail,selected,select,openComments,feedback}:{detail:ResultDetail;selected:boolean;select():void;openComments():void;feedback():void}){
 const {bootstrap}=useSession(),[scope]=useScope(),{resultId,revision}=useParams(),comments=useComments(detail),operation=useResultOperation(detail.result.project_id,"results.comment"),[following,setFollowing]=useState<boolean|null>(null);
 const [desired,setDesired]=useState(true),[intent,setIntent]=useState<boolean|null>(null);
 const date=new Date(detail.revision.submitted_at_ms),items=comments.data?.pages.flatMap(p=>p.items)??[],count=items.length,more=!!comments.data?.pages.at(-1)?.next_cursor;
 const required=detail.revision.capture_policy.requirements.filter(r=>r.required),evaluations=detail.assessment.evidence.requirements;
 const needed=required.reduce((sum,r)=>sum+r.count,0),attached=required.reduce((sum,r)=>sum+Math.min(r.count,evaluations.find(e=>e.requirement_id===r.id&&e.policy_revision===r.policy_revision)?.artifact_ids.length??0),0);
 useEffect(()=>{if(operation.status?.disposition==="confirmed"&&intent!==null)setFollowing(intent);},[operation.status,intent]);
 async function follow(){if(operation.id){if(operation.status?.disposition==="confirmed")operation.reset();else return;}const next=following===null?desired:!following;setIntent(next);const payload={operation_id:crypto.randomUUID(),expected_version:detail.result.version,following:next};validateResultPayload("Follow",payload);await operation.submit("PUT",`/api/v1/results/${detail.result.id}/follow`,payload);}
 return <article className={`${styles.card} ${selected?styles.selected:""}`} aria-label={`Result ${detail.result.id}`}>
  <header className={styles.header}><div><p className={styles.eyebrow}>RESULT · <time dateTime={date.toISOString()}>{date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}</time></p><h2 className={styles.title}>{detail.revision.summary}</h2></div><span className={styles.badge}>Acceptance: {detail.assessment.acceptance}</span></header>
  <p className={styles.meta}>Task {bootstrap.capability("tasks.read").enabled?<Link to={{pathname:`/work/${detail.result.task_id}`,search:scopeSearch({kind:"project",project_id:detail.result.project_id})}}>{detail.result.task_id.slice(-8)}</Link>:detail.result.task_id.slice(-8)} · Project {detail.result.project_id.slice(-8)} · Attempt {detail.revision.attempt_id.slice(-8)} · Source base {detail.revision.source.base.hex.slice(0,7)}</p>
  <p className={styles.evidence}>{needed?`${attached} of ${needed} required captures attached`:"No required captures in this revision’s policy"} · {detail.assessment.evidence.satisfied?"Evidence requirements satisfied":"Evidence requirements incomplete"}</p>
  {bootstrap.capability("results.media.read").enabled?<ResultMedia binding={mediaBinding(detail)}/>:<div className={styles.mediaUnavailable}><p>Images unavailable</p><p className={styles.meta}>{capReason(bootstrap.capability("results.media.read"))}</p></div>}
  <div className={styles.cardFacts}><span>{detail.assessment.artifacts.length} supplemental artifacts</span><span>{detail.revision.artifacts.length} submitted artifacts</span><Link to={{pathname:`/results/${detail.result.id}/revisions/${detail.revision.revision}`,search:scopeSearch(scope)}}>Exact revision</Link></div>
  <details className={styles.context}><summary>Result context and evidence</summary><dl className={styles.facts}><dt>Result</dt><dd>{detail.result.id}</dd><dt>Exact revision</dt><dd>{detail.revision.revision}</dd><dt>Attempt</dt><dd>{detail.revision.attempt_id}</dd><dt>Repository</dt><dd>{detail.revision.source.repository_id}</dd><dt>Source base</dt><dd>{detail.revision.source.base.hex}</dd></dl><p className={styles.meta}>Source base declared by the report. Evidence presence and acceptance are separate observations.</p>{required.map(r=><p key={r.id} className={styles.meta}>{r.scenario} · {r.environment} · {r.viewport.width_css} × {r.viewport.height_css} · {evaluations.find(e=>e.requirement_id===r.id)?.state??"Unknown"}</p>)}</details>{resultId&&revision&&<ResultMediaUpload binding={mediaBinding(detail)}/>}
  {items[0]&&<div className={styles.preview} onClick={select}><CommentView comment={items[0]} detail={detail}/></div>}
  {comments.isError&&<p className={styles.meta}>Comment preview unavailable.</p>}
  <footer className={styles.cardActions}><ActionButton className={styles.primary} disabled={!bootstrap.capability("results.feedback").enabled} title={capReason(bootstrap.capability("results.feedback"))} onClick={feedback}>Create feedback task</ActionButton><ActionButton onClick={openComments}>{comments.isPending?"Comments…":comments.isError?"Comments unavailable":`Comments ${count}${more?"+":""}`}</ActionButton><Link className={styles.review} to={{pathname:"/decisions",search:`${scopeSearch({kind:"project",project_id:detail.result.project_id})}&result_id=${detail.result.id}&revision=${detail.revision.revision}`}}>Review result</Link></footer>
  {bootstrap.capability("results.comment").enabled&&<div className={styles.follow}>{following===null&&<label className={styles.meta}>Direct follow state unavailable <select aria-label="Set following" value={desired?"yes":"no"} onChange={e=>setDesired(e.target.value==="yes")}><option value="yes">Follow</option><option value="no">Unfollow</option></select></label>}<ActionButton disabled={operation.busy||!!operation.id&&operation.status?.disposition!=="confirmed"} aria-pressed={following===null?undefined:following} onClick={()=>void follow()}>{following===null?"Apply follow preference":following?"Unfollow":"Follow"}</ActionButton>{operation.status?.disposition==="confirmed"&&<span className={styles.meta}>Preference saved for this operation.</span>}<OperationStatus operation={operation}/></div>}
 </article>;
}

function capReason(cap:{enabled:boolean;reason?:string}){return cap.reason??"";}
