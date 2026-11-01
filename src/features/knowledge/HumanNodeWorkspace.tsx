import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen, List, Workflow } from "lucide-react";
import { useScope, scopeSearch } from "../../app/scope";
import { useProjects } from "../../app/useProjects";
import { useGraphList, useGraphDetail } from "../../api/humanGraphReads";
import { mergeGraphPages, validGraphId, GRAPH_MAX_PAGES, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, DetailList, Panel, Toolbar } from "../../components/layout/Workspace";
import { HumanTaskGraph } from "../work/graph/HumanTaskGraph";
import styles from "./HumanNodeWorkspace.module.css";

function withoutRevision(search:string) { const params=new URLSearchParams(search);params.delete("revision");const value=params.toString();return value?`?${value}`:""; }
const pathFor=(kind:GraphNode["kind"],id?:string)=>`/${kind === "task" ? "work" : "knowledge"}${id?`/${encodeURIComponent(id)}`:""}`;
function ProjectChoice({kind}:{kind:GraphNode["kind"]}) {
  const projects=useProjects();
  return <Panel title="Choose a project" description={`Select a project to browse its ${kind === "task" ? "tasks and dependencies" : "knowledge records"}.`}>
    {!projects.data ? <QueryStatus status={projects.isError?"error":"pending"} error={projects.error} label="projects" onRetry={()=>void projects.refetch()}/> :
      projects.data.view.length ? <ul className={styles.projectList}>{projects.data.view.map(p=><li key={p.id}><Link to={{pathname:pathFor(kind),search:scopeSearch({kind:"project",project_id:p.id})}}>{p.label}</Link></li>)}</ul> : <p>No projects are available to this account.</p>}
  </Panel>;
}
export function HumanNodeWorkspace({kind}:{kind:GraphNode["kind"]}) {
  const [scope]=useScope();const route=useParams();const id=kind === "task" ? route.taskId : route.nodeId;
  if(scope.kind !== "project")return <ProjectChoice kind={kind}/>;
  if(!validGraphId(scope.project_id) || (id && !validGraphId(id)))return <p role="status">This item does not exist or is not available to you.</p>;
  return <ProjectWorkspace key={`${scope.project_id}:${kind}`} project={scope.project_id} kind={kind} id={id}/>;
}
function ProjectWorkspace({project,kind,id}:{project:string;kind:GraphNode["kind"];id?:string}) {
  const [params,setParams]=useSearchParams();
  const [draft,setDraft]=useState(params.get("q")??"");const q=(params.get("q")??"").slice(0,256);
  const [category,setCategory]=useState("");const [lifecycle,setLifecycle]=useState("");const [verification,setVerification]=useState("");
  const query=useGraphList(project,kind,q);let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const search=params.toString()?`?${params}`:"";const graph=kind === "task" && params.get("view")==="graph";
  const filtered=rows.filter(n=>(!category || n.content_type===category)&&(!lifecycle || (lifecycle==="retired"?n.retired:!n.retired))&&(!verification || n.verification===verification));
  const categories=[...new Set(rows.map(n=>n.content_type).filter((v):v is string=>!!v))].sort();
  const projectName=query.data?.pages[0]?.project.name;
  const update=(key:string,value:string)=>setParams(p=>{const n=new URLSearchParams(p);if(value)n.set(key,value);else n.delete(key);return n;});
  return <div className={styles.workspace} data-detail={!!id} data-view={graph?"graph":"list"}>
    <p className={styles.subtitle}>{kind==="knowledge"?"Find the decisions, procedures, and evidence behind the work.":"Inspect project tasks and their recorded dependencies."}{projectName && <span> · {projectName}</span>}</p>
    <Toolbar className={styles.filters}>
      <form onSubmit={e=>{e.preventDefault();update("q",draft.trim());}} className={styles.search}>
        <label className="visually-hidden" htmlFor={`find-${kind}`}>Search {kind==="task"?"tasks":"knowledge"}</label>
        <input id={`find-${kind}`} type="search" maxLength={256} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={`Search project ${kind==="task"?"tasks":"knowledge"}…`}/>
        <ActionButton type="submit">Search</ActionButton>
      </form>
      {kind==="knowledge" && <>
        <label><span className="visually-hidden">Category of loaded records</span><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories loaded</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
        <label><span className="visually-hidden">Lifecycle of loaded records</span><select value={lifecycle} onChange={e=>setLifecycle(e.target.value)}><option value="">All lifecycle states loaded</option><option value="active">Active records</option><option value="retired">Retired records</option></select></label>
        <label><span className="visually-hidden">Verification of loaded records</span><select value={verification} onChange={e=>setVerification(e.target.value)}><option value="">Any verification loaded</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option></select></label>
      </>}
      {kind==="task" && <nav aria-label="Work view" className={styles.views}><ActionButton aria-pressed={!graph} onClick={()=>update("view","")}><List size={18} aria-hidden/>List</ActionButton><ActionButton aria-pressed={graph} onClick={()=>update("view","graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton></nav>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.listPane}>
      {graph ? id ? <HumanTaskGraph project={project} root={id} search={search}/> : <Panel title="Dependency graph"><p>Select a task from the list to open its neighborhood.</p><ActionButton onClick={()=>update("view","")}>Choose a task</ActionButton></Panel> :
      <Panel title={`${filtered.length} ${kind==="task"?"tasks":"records"} loaded`} actions={<ActionButton disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh list</ActionButton>}>
        {query.isError || mergeError || !query.data ? <QueryStatus status={query.isError||mergeError?"error":"pending"} error={mergeError??query.error} label={kind==="task"?"tasks":"knowledge records"} onRetry={()=>void query.refetch()}/> : <>
          {!filtered.length && <p>{rows.length?"No loaded records match these filters.":"No records returned for this search."}</p>}
          <ul className={styles.records} aria-label={kind==="task"?"Tasks":"Knowledge records"}>{filtered.map(n=><li key={n.id} data-selected={id===n.id}><Link className={styles.record} aria-current={id===n.id?"page":undefined} to={{pathname:pathFor(kind,n.id),search:withoutRevision(search)}}><BookOpen size={21} aria-hidden/><span><strong>{n.title}</strong><span className={styles.meta}>{kind==="task"?nodeLabel(n.task_state):n.content_type??"Uncategorized"} · {n.deleted?"Deleted":n.retired?"Retired":"Active"} · {nodeLabel(n.verification)}</span></span><span className={styles.revision}>r{n.content_revision}</span></Link></li>)}</ul>
          {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more {kind==="task"?"tasks":"records"}</ActionButton>}
          {query.data.pages.length===GRAPH_MAX_PAGES && query.data.pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
          <p className={styles.meta}>Loaded records only; this is not a project total.</p>
        </>}
      </Panel>}
      </div>
      {id ? <NodeDetail key={`${id}:${params.get("revision")??"current"}`} project={project} kind={kind} id={id} search={search}/> : <Panel title={kind==="knowledge"?"Project knowledge":"Task inspector"} className={styles.emptyInspector}><BookOpen size={34} aria-hidden/><p>Select a {kind==="task"?"task":"record"} to read its content and exact revision.</p></Panel>}
    </div>
  </div>;
}
function NodeDetail({project,kind,id,search}:{project:string;kind:GraphNode["kind"];id:string;search:string}) {
  const [params,setParams]=useSearchParams();const raw=params.get("revision");const pinned=kind==="knowledge" && raw && /^[1-9][0-9]{0,19}$/.test(raw)?raw:undefined;
  const query=useGraphDetail(project,kind,id,pinned);const [tab,setTab]=useState("content");const [revision,setRevision]=useState(pinned??"");
  if(raw && kind==="knowledge" && !pinned)return <p role="status">This revision is not available.</p>;
  if(!query.data || query.isError)return <Panel title="Record"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="this record" onRetry={()=>void query.refetch()}/></Panel>;
  const n=query.data.data;
  return <Panel title={n.title} className={styles.detail}>
    <Link to={{pathname:pathFor(kind),search:withoutRevision(search)}} className={styles.back}>All {kind==="task"?"tasks":"records"}</Link>
    <div className={styles.badges}><span>{kind==="task"?`Task state: ${nodeLabel(n.task_state)}`:n.content_type??"Uncategorized"}</span><span>{kind==="task"?"Lifecycle: ":""}{n.deleted?"Deleted":n.retired?"Retired":"Active"}</span><span>{nodeLabel(n.verification)}</span><span>{pinned?"Pinned":"Current"} revision {n.content_revision}</span></div>
    <p className={styles.meta}>Project: {query.data.project.name} · Updated <time dateTime={n.updated_at}>{n.updated_at}</time></p>
    <div className={styles.tabs} role="group" aria-label="Record sections">{["content","sources","record"].map(t=><ActionButton key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==="content"?"Content":t==="sources"?`Sources (${n.provenance.length})`:"Record & revisions"}</ActionButton>)}</div>
    {tab==="content" && <div className={styles.prose}><p>{n.body||"No body recorded."}</p>{n.acceptance_criteria && <><h3>Acceptance criteria</h3><p>{n.acceptance_criteria}</p></>}{n.labels.length>0 && <p className={styles.meta}>Labels: {n.labels.join(", ")}</p>}
      <section className={styles.verification}><h3>Verification</h3><p>{nodeLabel(n.verification)}{n.last_verified_by?` · Recorded by ${n.last_verified_by}`:""}</p>{n.last_verified_at && <p>Recorded <time dateTime={n.last_verified_at}>{n.last_verified_at}</time></p>}{n.review_at && <p>Review at {n.review_at}</p>}</section>
    </div>}
    {tab==="sources" && (n.provenance.length?<ul className={styles.sources} aria-label="Recorded sources">{n.provenance.map((source,i)=><li key={i}><pre>{JSON.stringify(source,null,2)}</pre></li>)}</ul>:<p>No sources recorded for this revision.</p>)}
    {tab==="record" && <div className={styles.recordDetails}><DetailList><dt>Author</dt><dd>{n.created_by}</dd><dt>Created</dt><dd>{n.created_at}</dd><dt>Record version</dt><dd>{n.version}</dd><dt>Content revision</dt><dd>{n.content_revision}</dd><dt>Valid from</dt><dd>{n.valid_from??"Not specified"}</dd><dt>Valid until</dt><dd>{n.valid_until??"Not specified"}</dd>{n.retirement_reason && <><dt>Retirement reason</dt><dd>{n.retirement_reason}</dd></>}{n.successor_id && <><dt>Successor</dt><dd><Link to={{pathname:pathFor(kind,n.successor_id),search:scopeSearch({kind:"project",project_id:project})}}>Open successor record</Link></dd></>}</DetailList>
      {kind==="knowledge" && <form className={styles.revisions} onSubmit={e=>{e.preventDefault();if(/^[1-9][0-9]{0,19}$/.test(revision))setParams(p=>{const out=new URLSearchParams(p);out.set("revision",revision);return out;});}}><label>Exact content revision<input value={revision} onChange={e=>setRevision(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]*" maxLength={20}/></label><ActionButton type="submit" disabled={!/^[1-9][0-9]{0,19}$/.test(revision)}>View revision</ActionButton>{pinned && <ActionButton onClick={()=>setParams(p=>{const out=new URLSearchParams(p);out.delete("revision");return out;})}>Return to current</ActionButton>}</form>}
    </div>}
    <p className={styles.footer}>{pinned?`Viewing pinned revision ${n.content_revision}`:`Current content revision ${n.content_revision}`} · Observed {query.data.observed_at}</p>
  </Panel>;
}
