import { RecordActions } from "../actions/RecordActions";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen, List, Workflow, ListChecks } from "lucide-react";
import { useScope } from "../../app/scope";
import { useProjects, useProjectsCapability } from "../../app/useProjects";
import { useGraphList, useGraphDetail } from "../../api/humanGraphReads";
import { mergeGraphPages, validGraphId, GRAPH_MAX_PAGES, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { HumanTaskGraph, PhoneGraphView, PHONE_QUERY, graphListTarget } from "../work/graph/HumanTaskGraph";
import { useMediaQuery } from "../../components/useMediaQuery";
import { KnowledgeDocument } from "./KnowledgeDocument";
import { HumanTaskInspector } from "../work/HumanTaskInspector";
import styles from "./HumanNodeWorkspace.module.css";

function withoutRevision(search:string) { const params=new URLSearchParams(search);params.delete("revision");const value=params.toString();return value?`?${value}`:""; }
const pathFor=(kind:GraphNode["kind"],id?:string)=>`/${kind === "task" ? "work" : "knowledge"}${id?`/${encodeURIComponent(id)}`:""}`;
function ProjectChoice({kind,id}:{kind:GraphNode["kind"];id?:string}) {
  const [params] = useSearchParams();
  const capability=useProjectsCapability();
  const projects=useProjects();
  return <Panel title="Choose a project" description={`Select a project to browse its ${kind === "task" ? "tasks and dependencies" : "knowledge records"}.`}>
    {!capability.enabled ? <div role="status"><p>Project list isn't offered by this AQ server — choose a project from the scope menu or open a project link.</p><p className={styles.meta}>Reason: {capability.reason}</p></div> :
      !projects.data ? <QueryStatus status={projects.isError?"error":"pending"} error={projects.error} label="projects" onRetry={()=>void projects.refetch()}/> :
      projects.data.view.length ? <ul className={styles.projectList}>{projects.data.view.map(p=><li key={p.id}><Link to={{pathname:pathFor(kind,id),search:(()=>{const next=new URLSearchParams(params);next.set("scope",`project:${p.id}`);return `?${next}`;})()}}>{p.label}</Link></li>)}</ul> : <p>No projects are available to this account.</p>}
  </Panel>;
}
export function HumanNodeWorkspace({kind}:{kind:GraphNode["kind"]}) {
  const [scope]=useScope();const route=useParams();const id=kind === "task" ? route.taskId : route.nodeId;
  if(scope.kind !== "project")return <ProjectChoice kind={kind} id={id}/>;
  if(!validGraphId(scope.project_id) || (id && !validGraphId(id)))return <p role="status">This item does not exist or is not available to you.</p>;
  return <ProjectWorkspace key={`${scope.project_id}:${kind}`} project={scope.project_id} kind={kind} id={id}/>;
}
function ProjectWorkspace({project,kind,id}:{project:string;kind:GraphNode["kind"];id?:string}) {
  const [params,setParams]=useSearchParams();
  const [draft,setDraft]=useState(params.get("q")??"");const q=(params.get("q")??"").slice(0,256);
  const [taskState,setTaskState]=useState("");
  const [category,setCategory]=useState("");const [lifecycle,setLifecycle]=useState("");const [verification,setVerification]=useState("");
  const query=useGraphList(project,kind,q);let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const search=params.toString()?`?${params}`:"";const graph=kind === "task" && params.get("view")==="graph";const phone=useMediaQuery(PHONE_QUERY);
  const workspace=useRef<HTMLDivElement>(null),previous=useRef<{id?:string;graph:boolean}>({graph:false});
  useEffect(()=>{
    const before=previous.current;previous.current={id,graph};
    const element=workspace.current;if(!element)return;
    // Selection focuses its heading; Back restores the previously selected row/node.
    // Phone graph: a node tap keeps the graph open, so focus stays on the tapped node.
    const restore=phone&&graph&&before.graph&&id?id:(!id || graph)?before.id:undefined;
    const focus=()=>{
      const target=id&&!graph?element.querySelector<HTMLElement>(`.${styles.detail} h2`):restore?[...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a=>new URL(a.href).pathname===pathFor(kind,restore)):undefined;
      if(!target)return false;
      if(target.tagName==="H2")target.tabIndex=-1;
      target.focus();return true;
    };
    if(focus())return;
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});
    observer.observe(element,{childList:true,subtree:true});return()=>observer.disconnect();
  },[id,graph,kind,phone]);
  const graphRoot=validGraphId(params.get("root"))?params.get("root")!:id;
  const filtered=rows.filter(n=>(!taskState || n.task_state===taskState)&&(!category || n.content_type===category)&&(!lifecycle || (lifecycle==="retired"?n.retired:!n.retired))&&(!verification || n.verification===verification));
  const categories=[...new Set(rows.map(n=>n.content_type).filter((v):v is string=>!!v))].sort();
  const projectName=query.data?.pages[0]?.project.name;
  // A failed or pending read has no count; never present it as "0 loaded" (spec 0002 §10).
  const noun=kind==="task"?"tasks":"records";
  const listTitle=query.isError || mergeError ? `${kind==="task"?"Tasks":"Records"} unavailable` : !query.data ? (kind==="task"?"Tasks":"Records") : `${filtered.length} ${noun} loaded`;
  const update=(key:string,value:string)=>setParams(p=>{const n=new URLSearchParams(p);if(value)n.set(key,value);else n.delete(key);if(key==="view" && value==="graph" && id && !n.has("root"))n.set("root",id);return n;});
  return <div ref={workspace} className={styles.workspace} data-kind={kind} data-detail={!!id} data-view={graph?"graph":"list"}>
    <p className={styles.subtitle}>{kind==="knowledge"?"Find the decisions, procedures, and evidence behind the work.":"Inspect project tasks and their recorded dependencies."}{projectName && <span> · {projectName}</span>}</p>
    {kind==="knowledge" && query.data?.pages[0] && <RecordActions record={{project:query.data.pages[0].project}} author />}
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
      {kind==="task" && <label><span className="visually-hidden">State of loaded tasks</span><select value={taskState} onChange={e=>setTaskState(e.target.value)}><option value="">{phone?"All states":"All task states loaded"}</option>{["draft","active","completed","canceled"].map(state=><option value={state} key={state}>{nodeLabel(state)}</option>)}</select></label>}
      {kind==="task" && <nav aria-label="Work view" className={styles.views}><ActionButton aria-pressed={!graph} onClick={()=>update("view","")}><List size={18} aria-hidden/>List</ActionButton><ActionButton aria-pressed={graph} onClick={()=>update("view","graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton></nav>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.listPane}>
      {graph && phone && !id ? <PhoneTaskGraph project={project} root={graphRoot??filtered[0]?.id} search={search} status={query.isError||mergeError?"error":!query.data?"pending":undefined} error={mergeError??query.error} onRetry={()=>void query.refetch()}/> :
      graph ? id ? <HumanTaskGraph project={project} root={graphRoot!} selected={id} search={search}/> : <Panel title="Dependency graph"><p>Select a task from the list to open its neighborhood.</p><ActionButton onClick={()=>update("view","")}>Choose a task</ActionButton></Panel> :
      <Panel title={listTitle} actions={<ActionButton disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh list</ActionButton>}>
        {query.isError || mergeError || !query.data ? <QueryStatus status={query.isError||mergeError?"error":"pending"} error={mergeError??query.error} label={kind==="task"?"tasks":"knowledge records"} onRetry={()=>void query.refetch()}/> : <>
          {!filtered.length && <p>{rows.length?"No loaded records match these filters.":"No records returned for this search."}</p>}
          <ul className={styles.records} aria-label={kind==="task"?"Tasks":"Knowledge records"}>{filtered.map(n=><li key={n.id} data-selected={id===n.id}><Link className={styles.record} aria-current={id===n.id?"page":undefined} to={{pathname:pathFor(kind,n.id),search:withoutRevision(search)}}>{kind === "task" ? <ListChecks size={21} aria-hidden/> : <BookOpen size={21} aria-hidden/>}<span><strong>{n.title}</strong><span className={styles.meta}>{kind==="task"?nodeLabel(n.task_state):n.content_type??"Uncategorized"} · {n.deleted?"Deleted":n.retired?"Retired":"Active"} · {nodeLabel(n.verification)}</span></span><span className={styles.revision}>r{n.content_revision}</span></Link></li>)}</ul>
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
/** Phone graph without a selected task: open the dedicated view on the root (or first loaded task) instead of a dead end. */
function PhoneTaskGraph({project,root,search,status,error,onRetry}:{project:string;root?:string;search:string;status?:"error"|"pending";error:unknown;onRetry:()=>void}) {
  if(root)return <HumanTaskGraph project={project} root={root} search={search}/>;
  return <PhoneGraphView backTo={graphListTarget(search)}><div className={styles.phoneGraphStatus}>{status ? <QueryStatus status={status} error={error} label="tasks" onRetry={onRetry}/> : <p>No loaded tasks to show in a graph.</p>}</div></PhoneGraphView>;
}
function NodeDetail({project,kind,id,search}:{project:string;kind:GraphNode["kind"];id:string;search:string}) {
  const [params]=useSearchParams();const raw=params.get("revision");const pinned=kind==="knowledge" && raw && /^[1-9][0-9]{0,19}$/.test(raw)?raw:undefined;
  const query=useGraphDetail(project,kind,id,pinned);
  if(raw && kind==="knowledge" && !pinned)return <p role="status">This revision is not available.</p>;
  if(!query.data)return <Panel title="Record"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="this record" onRetry={()=>void query.refetch()}/></Panel>;
  const notice=query.isError?<p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={()=>void query.refetch()}>Refresh record</ActionButton></p>:undefined;
  return kind === "task" ? <HumanTaskInspector record={query.data} search={withoutRevision(search)} notice={notice}/> : <KnowledgeDocument record={query.data} pinned={pinned} notice={notice}/>;
}
