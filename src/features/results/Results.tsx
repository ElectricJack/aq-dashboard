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
import {Icon} from "../../components/icons";
import {formatAge} from "../../components/time/relative";
import {useServerNow} from "../../components/time/useServerNow";
import {ArrowRight,CircleAlert,CircleCheck,Clock,FileText,Image as ImageGlyph,MessageSquare,Paperclip,RefreshCw,SlidersHorizontal,Video} from "lucide-react";
import {ResultMedia,ResultMediaWindow,resultMediaKey} from "./ResultMedia";
import {ResultMediaUpload} from "./ResultMediaUpload";
import {ResultDiscussion} from "./ResultDiscussion";
import {FeedbackDraft} from "./FeedbackDraft";
import {OperationStatus,useResultOperation} from "./useResultOperation";
import styles from "./Results.module.css";
const ranges=[['any','Any time'],['24h','Last 24 hours'],['7d','Last 7 days'],['30d','Last 30 days'],['custom','Custom…']] as const;
const rangeMs:Record<string,number>={"24h":864e5,"7d":7*864e5,"30d":30*864e5};
const medias=[['any','All media'],['image','Images'],['none','No media']] as const;
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
 return <Feed key={JSON.stringify([queryContext,scope,resultId,revision,params.get("mode"),params.get("task"),params.get("media"),params.get("range"),params.get("since"),params.get("until")])} scope={scope}/>;
}
function Feed({scope}:{scope:Scope}){
 const {queryContext}=useSession(),{resultId,revision}=useParams(),[params,setParams]=useSearchParams(),[,setScope]=useScope(),projects=useProjects();
 const mode=modes.some(([value])=>value===params.get("mode"))?params.get("mode")!:"latest",project=scope.kind==="project"?scope.project_id:undefined;
 const exact=resultId&&revision?{id:resultId,revision}:undefined;
 const task=params.get("task")??"",media=params.get("media")??"any",since=params.get("since")??"",until=params.get("until")??"";
 const range=ranges.some(([value])=>value===params.get("range"))?params.get("range")!:since||until?"custom":"any";
 const [selected,setSelected]=useState<string|null>(null),[panelOpen,setPanelOpen]=useState(true),[sheet,setSheet]=useState(false),[drafts,setDrafts]=useState<{detail:ResultDetail;comment?:string;open:boolean}[]>([]),[arrivals,setArrivals]=useState(false),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState<string|null>(null);
 const key=JSON.stringify([queryContext,scope,resultId,revision,mode,task,media,range,since,until]),restored=useRef(false),active=useRef(true),probe=useRef<AbortController|null>(null);
 const filterParams=()=>{const p=new URLSearchParams({mode,scope:scope.kind,media:["any","image","none"].includes(media)?media:"any",limit:"10"});if(project)p.set("project_id",project);if(task)p.set("task_id",task);if(rangeMs[range])p.set("since_ms",String(Date.now()-rangeMs[range]));else if(range==="custom"){if(since)p.set("since_ms",String(new Date(since).getTime()));if(until)p.set("until_ms",String(new Date(until).getTime()));}return p;};
 const query=useInfiniteQuery({queryKey:scopedKey(queryContext,scope,"result-feed",{resultId,revision,mode,task,media,range,since,until}),initialPageParam:null as string|null,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:false,
  queryFn:async({pageParam,signal})=>{const p=filterParams();if(pageParam)p.set("cursor",pageParam);if(exact){const raw=await apiGet<unknown>(`/api/v1/results/${exact.id}/revisions/${exact.revision}${project?`?project_id=${project}`:""}`,signal);return {items:[adaptResultDetail(raw,exact,project)],next_cursor:null,anchor:serverAnchor(raw)};}const raw=await apiGet<unknown>(`/api/v1/results?${p}`,signal);return {...adaptResultsFeed(raw,scope),anchor:serverAnchor(raw)};},getNextPageParam:(last,pages)=>!exact&&pages.length<4?last.next_cursor??undefined:undefined});
 const items=query.data?.pages.flatMap(p=>p.items)??[],now=useServerNow(query.data?.pages[0]?.anchor,{tickMs:30_000});
 const projectLabel=(id:string)=>projects.data?.view.find(p=>p.id===id)?.label??`Project ${id.slice(-8)}`;
 useEffect(()=>{const id=params.get("feedback_operation"),result=params.get("feedback_result"),revision=params.get("feedback_revision");if(!id||drafts.some(d=>d.detail.result.id===result&&d.detail.revision.revision===revision))return;const detail=items.find(i=>i.result.id===result&&i.revision.revision===revision);if(detail)openDraft(detail);});
 const current=items.find(i=>i.result.id===selected)??items[0],comments=useComments(current);
 useEffect(()=>{active.current=true;return()=>{active.current=false;probe.current?.abort();reading.set(key,window.scrollY);if(reading.size>16)reading.delete(reading.keys().next().value!);};},[key]);
 useEffect(()=>{if(query.data&&!restored.current){restored.current=true;const y=reading.get(key);if(y!==undefined)requestAnimationFrame(()=>window.scrollTo(0,y));}},[query.data,key]);
 async function check(){if(checking||exact)return;setChecking(true);setCheckError(null);const controller=new AbortController();probe.current=controller;try{const page=adaptResultsFeed(await apiGet<unknown>(`/api/v1/results?${filterParams()}`,controller.signal),scope);if(active.current)setArrivals(JSON.stringify(page.items.map(i=>[i.result.id,i.revision.revision]))!==JSON.stringify(query.data?.pages[0]?.items.map(i=>[i.result.id,i.revision.revision])));}catch{if(active.current)setCheckError("Could not check for new results.");}finally{if(active.current)setChecking(false);}}
 useEffect(()=>{if(exact)return;const timer=setInterval(()=>{if(document.visibilityState==="visible")void check();},60000);return()=>clearInterval(timer);});
 function openDraft(detail:ResultDetail,comment?:string){setDrafts(old=>old.some(d=>d.detail.result.id===detail.result.id&&d.detail.revision.revision===detail.revision.revision)?old.map(d=>({...d,open:d.detail.result.id===detail.result.id&&d.detail.revision.revision===detail.revision.revision})):[...old.map(d=>({...d,open:false})),{detail,comment,open:true}]);}
 if(!query.data||query.isError)return <QueryStatus status={query.isError?"error":"pending"} error={query.error} label="results" onRetry={()=>void query.refetch()}/>;
 if(new Set(items.map(i=>i.result.id)).size!==items.length)throw new ContractError("Result snapshot contains duplicate identities");
 return <ResultMediaWindow keys={items.map(i=>resultMediaKey(mediaBinding(i)))}><div className={styles.layout}>
  <p className={styles.subtitle}>See what changed. Give feedback where it matters.</p>
  <FeedToolbar exact={!!exact} scope={scope} mode={mode} media={media} range={range} task={task} since={since} until={until} checking={checking} projects={projects.data?.view??[]} onScope={setScope} onCheck={()=>void check()} onChange={changes=>setParams(old=>{const next=new URLSearchParams(old);for(const [name,value] of Object.entries(changes)){if(value)next.set(name,value);else next.delete(name);}return next;})}/>
  {checkError&&<p role="status">{checkError}</p>}{arrivals&&<ActionButton className={styles.arrivals} onClick={()=>{setArrivals(false);void query.refetch();}}>New results available</ActionButton>}
  <div className={styles.columns}><div className={styles.feedColumn}>{items.length?<ul className={styles.feed} aria-label="Results feed">{items.map(item=><li key={`${item.result.id}:${item.revision.revision}`}><ResultCard detail={item} now={now} projectLabel={projectLabel(item.result.project_id)} selected={current?.result.id===item.result.id} openComments={()=>{setSelected(item.result.id);if(panelVisible())setPanelOpen(true);else setSheet(true);}}/></li>)}</ul>:<div className={styles.empty}>No results in this scope and filter.</div>}
   {query.hasNextPage&&<ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more</ActionButton>}{query.data.pages.length===4&&query.data.pages.at(-1)?.next_cursor&&<p>Showing 40 results. Narrow the filters to read more.</p>}
  </div>{current&&panelOpen&&<ResultDiscussion key={`${current.result.id}:${current.revision.revision}`} detail={current} query={comments} onClose={()=>setPanelOpen(false)} onFeedback={id=>openDraft(current,id)}/>}</div>
  {sheet&&current&&<ResultDiscussion key={`sheet:${current.result.id}`} detail={current} query={comments} sheet onClose={()=>setSheet(false)} onFeedback={id=>openDraft(current,id)}/>}
  {drafts.map(draft=><RetainedDraft key={`${draft.detail.result.id}:${draft.detail.revision.revision}`} draft={draft} onClose={()=>setDrafts(old=>old.map(d=>d===draft?{...d,open:false}:d))}/>)}
 </div></ResultMediaWindow>;
}
type Filters={mode:string;media:string;range:string;task:string;since:string;until:string};
function FeedToolbar({exact,scope,projects,checking,onScope,onCheck,onChange,...f}:Filters&{exact:boolean;scope:Scope;projects:readonly {id:string;label:string}[];checking:boolean;onScope(scope:Scope):void;onCheck():void;onChange(changes:Partial<Record<"mode"|"media"|"range"|"task"|"since"|"until",string>>):void}){
 const [open,setOpen]=useState(false),[range,setRange]=useState(f.range),from=useRef<HTMLInputElement>(null),active=(f.task?1:0)+(f.range==="custom"?1:0);
 useEffect(()=>{if(open&&range==="custom")from.current?.focus();},[open,range]);
 function pickRange(value:string){setRange(value);if(value==="custom")setOpen(true);else onChange({range:value==="any"?"":value,since:"",until:""});}
 return <><div className={styles.toolbar}>
  {exact?<Link className={styles.back} to={{pathname:"/results",search:scopeSearch(scope)}}>Back to results</Link>:<div role="tablist" aria-label="Result feed mode" className={styles.tabs}>{modes.map(([value,label])=><button key={value} role="tab" aria-selected={f.mode===value} onClick={()=>onChange({mode:value})}>{label}</button>)}</div>}
  <div className={styles.controls}><ScopePicker className={styles.picker} scope={scope} onChange={onScope} projects={projects}/>
   {!exact&&<><select className={styles.media} aria-label="Media type" value={f.media} onChange={e=>onChange({media:e.target.value==="any"?"":e.target.value})}>{medias.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <select className={styles.time} aria-label="Time range" value={range} onChange={e=>pickRange(e.target.value)}>{ranges.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <button type="button" className={`${styles.control} ${styles.more}`} aria-expanded={open} aria-controls="results-more-filters" onClick={()=>{setOpen(!open);if(open)setRange(f.range);}}><Icon icon={SlidersHorizontal} size={18}/><span className={styles.moreLabel}>More filters</span>{active>0&&<span className={styles.count}>{active}<span className="visually-hidden"> active</span></span>}</button>
   <button type="button" className={`${styles.control} ${styles.check}`} title="Check for new results" disabled={checking} onClick={onCheck}><Icon icon={RefreshCw} size={18}/><span className="visually-hidden">Check for new results</span></button></>}
  </div></div>
  {!exact&&open&&<form id="results-more-filters" className={styles.filters} aria-label="More filters" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget),since=String(data.get("since")??""),until=String(data.get("until")??"");const custom=range==="custom"||!!(since||until);onChange({task:String(data.get("task")??"").trim(),range:custom?"custom":range==="any"?"":range,since:custom?since:"",until:custom?until:""});setOpen(false);}}>
   <label>Task ID<input name="task" defaultValue={f.task}/></label><label>Submitted from<input ref={from} type="datetime-local" name="since" defaultValue={f.since}/></label><label>Submitted through<input type="datetime-local" name="until" defaultValue={f.until}/></label><ActionButton type="submit">Apply filters</ActionButton>
  </form>}</>;
}
function RetainedDraft({draft,onClose}:{draft:{detail:ResultDetail;comment?:string;open:boolean};onClose():void}){const comments=useComments(draft.detail);return <FeedbackDraft detail={draft.detail} comments={comments.data?.pages.flatMap(p=>p.items)??[]} initial={draft.comment} open={draft.open} onClose={onClose} onRefresh={async()=>{const next=await comments.refetch();if(next.error)throw next.error;return next.data?.pages.flatMap(p=>p.items)??[];}}/>;}
function ResultCard({detail,selected,now,projectLabel,openComments}:{detail:ResultDetail;selected:boolean;now:string|null;projectLabel:string;openComments():void}){
 const {bootstrap}=useSession(),[scope]=useScope(),{resultId,revision}=useParams(),comments=useComments(detail),operation=useResultOperation(detail.result.project_id,"results.comment"),[following,setFollowing]=useState<boolean|null>(null);
 const [desired,setDesired]=useState(true),[intent,setIntent]=useState<boolean|null>(null);
 const date=new Date(detail.revision.submitted_at_ms),iso=date.toISOString(),absolute=date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}),items=comments.data?.pages.flatMap(p=>p.items)??[],count=items.length,more=!!comments.data?.pages.at(-1)?.next_cursor;
 const required=detail.revision.capture_policy.requirements.filter(r=>r.required),evaluations=detail.assessment.evidence.requirements;
 const needed=required.reduce((sum,r)=>sum+r.count,0),attached=required.reduce((sum,r)=>sum+Math.min(r.count,evaluations.find(e=>e.requirement_id===r.id&&e.policy_revision===r.policy_revision)?.artifact_ids.length??0),0);
 const status=resultStatus(detail.assessment),kinds=detail.revision.capture_policy.requirements.map(r=>r.kind),prior=detail.revision.parent_results[0];
 const glyph=kinds.some(k=>/video|clip/i.test(k))?Video:kinds.some(k=>/image|png/i.test(k))?ImageGlyph:FileText;
 const project={kind:"project" as const,project_id:detail.result.project_id},taskShort=detail.result.task_id.slice(-8);
 useEffect(()=>{if(operation.status?.disposition==="confirmed"&&intent!==null)setFollowing(intent);},[operation.status,intent]);
 async function follow(){if(operation.id){if(operation.status?.disposition==="confirmed")operation.reset();else return;}const next=following===null?desired:!following;setIntent(next);const payload={operation_id:crypto.randomUUID(),expected_version:detail.result.version,following:next};validateResultPayload("Follow",payload);await operation.submit("PUT",`/api/v1/results/${detail.result.id}/follow`,payload);}
 const evidence=<p className={styles.evidence}><Icon icon={detail.assessment.evidence.satisfied?CircleCheck:Paperclip} size={18}/><span>{needed?`${attached} of ${needed} required captures attached`:"No required captures in this revision’s policy"} · {detail.assessment.evidence.satisfied?"Evidence requirements satisfied":"Evidence requirements incomplete"}</span></p>;
 return <article className={`${styles.card} ${selected?styles.selected:""}`} aria-label={`Result ${detail.result.id}`}>
  <header className={styles.header}><span className={styles.mediaIcon}><Icon icon={glyph} size={20}/></span><div className={styles.heading}><h2 className={styles.title}>{detail.revision.summary}</h2>
   <p className={styles.meta}>{projectLabel} · Task {bootstrap.capability("tasks.read").enabled?<Link to={{pathname:`/work/${detail.result.task_id}`,search:scopeSearch(project)}}>{taskShort}</Link>:taskShort} · <span title={detail.revision.revision}>Result {detail.revision.revision.slice(0,7)}</span> · <time dateTime={iso} title={absolute}>{now?formatAge(now,iso):absolute}</time></p></div>
   <span className={`${styles.status} ${styles[status.tone]}`} data-result-status=""><Icon icon={status.icon} size={16}/>{status.label}</span></header>
  <p className={styles.attempt}>Attempt {detail.revision.attempt_id.slice(-8)} · Source base {detail.revision.source.base.hex.slice(0,7)}</p>
  {bootstrap.capability("results.media.read").enabled?<ResultMedia binding={mediaBinding(detail)} evidence={evidence}/>:<div className={styles.mediaRow}><div className={styles.mediaUnavailable}><p>Images unavailable</p><p className={styles.meta}>{capReason(bootstrap.capability("results.media.read"))}</p></div>{evidence}</div>}
  <details className={styles.context}><summary>Result context and evidence</summary>
   <div className={styles.cardFacts}><span>{detail.assessment.artifacts.length} supplemental artifacts</span><span>{detail.revision.artifacts.length} submitted artifacts</span><Link to={{pathname:`/results/${detail.result.id}/revisions/${detail.revision.revision}`,search:scopeSearch(scope)}}>Exact revision</Link></div>
   <dl className={styles.facts}><dt>Result</dt><dd>{detail.result.id}</dd><dt>Exact revision</dt><dd>{detail.revision.revision}</dd><dt>Attempt</dt><dd>{detail.revision.attempt_id}</dd><dt>Repository</dt><dd>{detail.revision.source.repository_id}</dd><dt>Source base</dt><dd>{detail.revision.source.base.hex}</dd></dl><p className={styles.meta}>Source base declared by the report. Evidence presence and acceptance are separate observations.</p>{required.map(r=><p key={r.id} className={styles.meta}>{r.scenario} · {r.environment} · {r.viewport.width_css} × {r.viewport.height_css} · {evaluations.find(e=>e.requirement_id===r.id)?.state??"Unknown"}</p>)}
   {bootstrap.capability("results.comment").enabled&&<div className={styles.follow}>{following===null&&<label className={styles.meta}>Direct follow state unavailable <select aria-label="Set following" value={desired?"yes":"no"} onChange={e=>setDesired(e.target.value==="yes")}><option value="yes">Follow</option><option value="no">Unfollow</option></select></label>}<ActionButton disabled={operation.busy||!!operation.id&&operation.status?.disposition!=="confirmed"} aria-pressed={following===null?undefined:following} onClick={()=>void follow()}>{following===null?"Apply follow preference":following?"Unfollow":"Follow"}</ActionButton>{operation.status?.disposition==="confirmed"&&<span className={styles.meta}>Preference saved for this operation.</span>}<OperationStatus operation={operation}/></div>}
  </details>{resultId&&revision&&<ResultMediaUpload binding={mediaBinding(detail)}/>}
  <footer className={styles.cardActions}><ActionButton className={styles.comments} aria-pressed={selected} onClick={openComments}><Icon icon={MessageSquare} size={18}/>{comments.isPending?"Comments…":comments.isError?"Comments unavailable":`Comments ${count}${more?"+":""}`}</ActionButton>
   {prior&&<Link className={styles.secondary} to={{pathname:`/results/${prior.result_id}/revisions/${prior.revision}`,search:scopeSearch(scope)}}>Compare {prior.revision.slice(0,7)}</Link>}
   <span className={styles.acceptance}>Acceptance: <strong>{humanize(detail.assessment.acceptance)}</strong></span>
   <Link className={styles.review} to={{pathname:"/decisions",search:`${scopeSearch(project)}&result_id=${detail.result.id}&revision=${detail.revision.revision}`}}>Review result<Icon icon={ArrowRight} size={18}/></Link></footer>
 </article>;
}
/** Status comes only from the assessment: no acceptance owner means submitted, never invented approval. */
function resultStatus(a:ResultDetail["assessment"]){
 if(a.acceptance==="accepted")return {label:"Accepted",tone:"success",icon:CircleCheck} as const;
 if(a.unresolved_review)return {label:"Needs review",tone:"attention",icon:CircleAlert} as const;
 if(a.acceptance==="unreviewed")return {label:"Submitted",tone:"neutral",icon:Clock} as const;
 return {label:humanize(a.acceptance),tone:"neutral",icon:Clock} as const;
}
function humanize(value:string){const text=value.replace(/_/g," ");return text.charAt(0).toUpperCase()+text.slice(1);}
function serverAnchor(raw:unknown){const time=(raw as {server_time?:unknown}).server_time;return typeof time==="string"?{serverTime:time,receivedAt:performance.now()}:undefined;}
/** The side discussion pane exists only at desktop widths (see Results.module.css). */
function panelVisible(){return typeof window.matchMedia==="function"&&window.matchMedia("(min-width: 1200px)").matches;}

function capReason(cap:{enabled:boolean;reason?:string}){return cap.reason??"";}
