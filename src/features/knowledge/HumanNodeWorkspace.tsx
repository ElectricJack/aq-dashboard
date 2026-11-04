import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen, Circle, List, ListChecks, Network, RefreshCw, Search as SearchIcon, Shield, Tag, Workflow, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useScope } from "../../app/scope";
import { PageTitle } from "../../app/DestinationPage";
import { useProjects, useProjectsCapability } from "../../app/useProjects";
import { useGraphList, useGraphDetail } from "../../api/humanGraphReads";
import { mergeGraphPages, validGraphId, GRAPH_MAX_PAGES, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { HumanTaskGraph } from "../work/graph/HumanTaskGraph";
import { KnowledgeDocument } from "./KnowledgeDocument";
import { AddRecordAction } from "./KnowledgeActions";
import { HumanTaskInspector } from "../work/HumanTaskInspector";
import { Icon, knowledgeCategoryIcon } from "../../components/icons";
import styles from "./HumanNodeWorkspace.module.css";

type Lifecycle = "active"|"retired"|"deleted";
const lifecycleOf=(n:GraphNode):Lifecycle=>n.deleted?"deleted":n.retired?"retired":"active";
const LIFECYCLE_LABEL:Record<Lifecycle,string>={active:"Active",retired:"Retired",deleted:"Deleted"};
const categoryLabel=(value:string|null)=>value?value.replace(/[_-]+/g," ").replace(/^./,c=>c.toUpperCase()):"Uncategorized";
const updated=(n:GraphNode)=>Date.parse(n.updated_at);
/** Short calendar date ("Oct 28"); the exact instant stays in the title. */
function shortDate(value:string) {
  const date=new Date(value),now=new Date();
  return date.toLocaleDateString(undefined,{month:"short",day:"numeric",...(date.getFullYear()!==now.getFullYear()?{year:"numeric"}:{})});
}
function FilterSelect({icon,label,value,onChange,children}:{icon:LucideIcon;label:string;value:string;onChange:(value:string)=>void;children:ReactNode}) {
  return <label className={styles.filter}><span className="visually-hidden">{label}</span><Icon icon={icon} size={18} className={styles.filterIcon}/><select value={value} onChange={e=>onChange(e.target.value)}>{children}</select></label>;
}
function Dot({tone,children}:{tone:string;children:ReactNode}) { return <span className={styles.dot} data-tone={tone}>{children}</span>; }
function KnowledgeRow({node}:{node:GraphNode}) {
  const lifecycle=lifecycleOf(node);
  return <>
    <Icon icon={knowledgeCategoryIcon(node.content_type)} size={24} className={styles.categoryIcon} data-category={node.content_type?.toLowerCase()}/>
    <span className={styles.recordText}><strong>{node.title}</strong><span className={styles.chips}>
      <Dot tone="category">{categoryLabel(node.content_type)}</Dot>
      <Dot tone={lifecycle}>{LIFECYCLE_LABEL[lifecycle]}</Dot>
      <Dot tone={node.verification??"unknown"}>{nodeLabel(node.verification)}</Dot>
    </span></span>
    <span className={styles.revision}><span className={styles.revisionNumber}>r{node.content_revision}</span><time dateTime={node.updated_at} title={node.updated_at}>{shortDate(node.updated_at)}</time></span>
  </>;
}

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
/**
 * Knowledge page header (reference 07): H1 with "Add record" on the same row and one subtitle.
 * The action slot stays in place in every state; the project name belongs to scope and document meta.
 */
function KnowledgeHeader({detail}:{detail:boolean}) {
  const [scope]=useScope();const [params]=useSearchParams();
  const project=scope.kind==="project" && validGraphId(scope.project_id) ? scope.project_id : "";
  // Same query key as the library list, so this shares its cache and adds no request.
  const list=useGraphList(project,"knowledge",(params.get("q")??"").slice(0,256));
  const pending=!project?"Choose a project first":list.isError?"Project records are unavailable":"Loading project records";
  return <header className={styles.pageHeader} data-detail={detail}>
    <div className={styles.pageHeading}><PageTitle>Knowledge</PageTitle><AddRecordAction project={list.data?.pages[0]?.project} pendingReason={pending}/></div>
    <p className={styles.subtitle}>Find the decisions, procedures, and evidence behind the work.</p>
  </header>;
}
export function HumanNodeWorkspace({kind}:{kind:GraphNode["kind"]}) {
  const [scope]=useScope();const route=useParams();const id=kind === "task" ? route.taskId : route.nodeId;
  const body=scope.kind !== "project" ? <ProjectChoice kind={kind} id={id}/> :
    !validGraphId(scope.project_id) || (id && !validGraphId(id)) ? <p role="status">This item does not exist or is not available to you.</p> :
    <ProjectWorkspace key={`${scope.project_id}:${kind}`} project={scope.project_id} kind={kind} id={id}/>;
  return kind==="knowledge" ? <><KnowledgeHeader detail={!!id}/>{body}</> : body;
}
function ProjectWorkspace({project,kind,id}:{project:string;kind:GraphNode["kind"];id?:string}) {
  const [params,setParams]=useSearchParams();
  const [draft,setDraft]=useState(params.get("q")??"");const q=(params.get("q")??"").slice(0,256);
  const [taskState,setTaskState]=useState("");
  const [category,setCategory]=useState("");const [lifecycle,setLifecycle]=useState("active");const [verification,setVerification]=useState("");const [sort,setSort]=useState("updated");
  const query=useGraphList(project,kind,q);let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const search=params.toString()?`?${params}`:"";const graph=kind === "task" && params.get("view")==="graph";
  const workspace=useRef<HTMLDivElement>(null),previous=useRef<{id?:string;graph:boolean}>({graph:false}),mounted=useRef(false);
  useEffect(()=>{
    const before=previous.current;previous.current={id,graph};
    // A deep link focuses the heading for screen readers without drawing a focus ring on arrival.
    // (A StrictMode re-run repeats the same selection, so it is still an arrival.)
    const arrival=!mounted.current || (before.id===id && before.graph===graph);mounted.current=true;
    const element=workspace.current;if(!element)return;
    // Selection focuses its heading; Back restores the previously selected row/node.
    const restore=(!id || graph)?before.id:undefined;
    const focus=()=>{
      const target=id&&!graph?element.querySelector<HTMLElement>(`.${styles.detail} h2`):restore?[...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a=>new URL(a.href).pathname===pathFor(kind,restore)):undefined;
      if(!target)return false;
      if(target.tagName==="H2")target.tabIndex=-1;
      target.focus(arrival?{focusVisible:false} as FocusOptions:undefined);return true;
    };
    if(focus())return;
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});
    observer.observe(element,{childList:true,subtree:true});return()=>observer.disconnect();
  },[id,graph,kind]);
  const graphRoot=validGraphId(params.get("root"))?params.get("root")!:id;
  const knowledge=kind==="knowledge";
  const filtered=rows.filter(n=>(!taskState || n.task_state===taskState)&&(!knowledge || ((!category || n.content_type===category)&&(lifecycle==="all" || lifecycleOf(n)===lifecycle)&&(!verification || n.verification===verification))));
  if(knowledge)filtered.sort(sort==="title"?(a,b)=>a.title.localeCompare(b.title):(a,b)=>updated(b)-updated(a));
  const noun=kind==="task"?(filtered.length===1?"task":"tasks"):(filtered.length===1?"record":"records");
  const categories=[...new Set(rows.map(n=>n.content_type).filter((v):v is string=>!!v))].sort();
  const projectName=query.data?.pages[0]?.project.name;
  // A failed or pending read has no count; never present it as "0 loaded" (spec 0002 §10).
  const listTitle=query.isError || mergeError ? `${kind==="task"?"Tasks":"Records"} unavailable` : !query.data ? (kind==="task"?"Tasks":"Records") : `${filtered.length} ${noun} loaded`;
  const update=(key:string,value:string)=>setParams(p=>{const n=new URLSearchParams(p);if(value)n.set(key,value);else n.delete(key);if(key==="view" && value==="graph" && id && !n.has("root"))n.set("root",id);return n;});
  return <div ref={workspace} className={styles.workspace} data-kind={kind} data-detail={!!id} data-view={graph?"graph":"list"}>
    {kind==="task" && <p className={styles.subtitle}>Inspect project tasks and their recorded dependencies.{projectName && <span> · {projectName}</span>}</p>}
    <Toolbar className={styles.filters}>
      <form onSubmit={e=>{e.preventDefault();update("q",draft.trim());}} className={styles.search}>
        <label className="visually-hidden" htmlFor={`find-${kind}`}>Search {kind==="task"?"tasks":"knowledge"}</label>
        {knowledge && <Icon icon={SearchIcon} size={18} className={styles.filterIcon}/>}
        <input id={`find-${kind}`} type="search" maxLength={256} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={`Search project ${kind==="task"?"tasks":"knowledge"}…`}/>
        {/* Knowledge submits on Enter, as in reference 07. */}
        {!knowledge && <ActionButton type="submit">Search</ActionButton>}
      </form>
      {knowledge && <>
        <FilterSelect icon={Tag} label="Category" value={category} onChange={setCategory}><option value="">All categories</option>{categories.map(c=><option key={c} value={c}>{categoryLabel(c)}</option>)}</FilterSelect>
        <FilterSelect icon={Circle} label="Lifecycle" value={lifecycle} onChange={setLifecycle}><option value="active">Active records</option><option value="retired">Retired records</option><option value="deleted">Deleted records</option><option value="all">Any lifecycle</option></FilterSelect>
        <FilterSelect icon={Shield} label="Verification" value={verification} onChange={setVerification}><option value="">Any verification</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option></FilterSelect>
        <div role="group" aria-label="Knowledge view" className={styles.segmented}>
          <button type="button" aria-pressed="true"><Icon icon={List} size={18}/>List</button>
          <button type="button" disabled title="Relationship browsing is not offered by this read contract"><Icon icon={Network} size={18}/>Relationships</button>
        </div>
      </>}
      {kind==="task" && <label><span className="visually-hidden">State of loaded tasks</span><select value={taskState} onChange={e=>setTaskState(e.target.value)}><option value="">All task states loaded</option>{["draft","active","completed","canceled"].map(state=><option value={state} key={state}>{nodeLabel(state)}</option>)}</select></label>}
      {kind==="task" && <nav aria-label="Work view" className={styles.views}><ActionButton aria-pressed={!graph} onClick={()=>update("view","")}><List size={18} aria-hidden/>List</ActionButton><ActionButton aria-pressed={graph} onClick={()=>update("view","graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton></nav>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.listPane}>
      {graph ? id ? <HumanTaskGraph project={project} root={graphRoot!} selected={id} search={search}/> : <Panel title="Dependency graph"><p>Select a task from the list to open its neighborhood.</p><ActionButton onClick={()=>update("view","")}>Choose a task</ActionButton></Panel> :
      <Panel title={listTitle} className={styles.listPanel} actions={knowledge ? <div className={styles.listActions}>
          <label><span className="visually-hidden">Sort records</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="updated">Updated recently</option><option value="title">Title A–Z</option></select></label>
          <ActionButton className={styles.iconButton} aria-label="Refresh list" title="Refresh list" disabled={query.isFetching} onClick={()=>void query.refetch()}><Icon icon={RefreshCw} size={18}/></ActionButton>
        </div> : <ActionButton disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh list</ActionButton>}>
        {query.isError || mergeError || !query.data ? <QueryStatus status={query.isError||mergeError?"error":"pending"} error={mergeError??query.error} label={kind==="task"?"tasks":"knowledge records"} onRetry={()=>void query.refetch()}/> : <>
          {!filtered.length && <p>{rows.length?"No loaded records match these filters.":"No records returned for this search."}</p>}
          <ul className={styles.records} aria-label={kind==="task"?"Tasks":"Knowledge records"}>{filtered.map(n=><li key={n.id} data-selected={id===n.id}><Link className={styles.record} aria-current={id===n.id?"page":undefined} to={{pathname:pathFor(kind,n.id),search:withoutRevision(search)}}>{knowledge ? <KnowledgeRow node={n}/> : <><ListChecks size={21} aria-hidden/><span><strong>{n.title}</strong><span className={styles.meta}>{nodeLabel(n.task_state)} · {LIFECYCLE_LABEL[lifecycleOf(n)]} · {nodeLabel(n.verification)}</span></span><span className={styles.revision}>r{n.content_revision}</span></>}</Link></li>)}</ul>
          {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more {kind==="task"?"tasks":"records"}</ActionButton>}
          {query.data.pages.length===GRAPH_MAX_PAGES && query.data.pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
          <p className={styles.meta}>{knowledge?"Filters and counts cover loaded records only; this is not a project total.":"Loaded records only; this is not a project total."}</p>
        </>}
      </Panel>}
      </div>
      {id ? <NodeDetail key={`${id}:${params.get("revision")??"current"}`} project={project} kind={kind} id={id} search={search}/> : <Panel title={kind==="knowledge"?"Project knowledge":"Task inspector"} className={styles.emptyInspector}><BookOpen size={34} aria-hidden/><p>Select a {kind==="task"?"task":"record"} to read its content and exact revision.</p></Panel>}
    </div>
  </div>;
}
function NodeDetail({project,kind,id,search}:{project:string;kind:GraphNode["kind"];id:string;search:string}) {
  const [params]=useSearchParams();const raw=params.get("revision");const pinned=kind==="knowledge" && raw && /^[1-9][0-9]{0,19}$/.test(raw)?raw:undefined;
  const query=useGraphDetail(project,kind,id,pinned);
  if(raw && kind==="knowledge" && !pinned)return <p role="status">This revision is not available.</p>;
  if(!query.data)return <Panel title="Record"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="this record" onRetry={()=>void query.refetch()}/></Panel>;
  const notice=query.isError?<p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={()=>void query.refetch()}>Refresh record</ActionButton></p>:undefined;
  return kind === "task" ? <HumanTaskInspector record={query.data} search={withoutRevision(search)} notice={notice}/> : <KnowledgeDocument record={query.data} pinned={pinned} notice={notice}/>;
}
