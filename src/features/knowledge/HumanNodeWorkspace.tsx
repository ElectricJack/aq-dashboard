import { RecordActions } from "../actions/RecordActions";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { BookOpen } from "lucide-react";
import { useScope } from "../../app/scope";
import { useProjects, useProjectsCapability } from "../../app/useProjects";
import { useGraphList, useGraphDetail } from "../../api/humanGraphReads";
import { mergeGraphPages, validGraphId, GRAPH_MAX_PAGES, type GraphNode, nodeLabel } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { KnowledgeDocument } from "./KnowledgeDocument";
import styles from "./HumanNodeWorkspace.module.css";

export function withoutRevision(search:string) { const params=new URLSearchParams(search);params.delete("revision");const value=params.toString();return value?`?${value}`:""; }
export const pathFor=(kind:GraphNode["kind"],id?:string)=>`/${kind === "task" ? "work" : "knowledge"}${id?`/${encodeURIComponent(id)}`:""}`;
/** Shared with Work (src/features/work/WorkWorkspace.tsx): honest project-scope choice. */
export function ProjectChoice({kind,id}:{kind:GraphNode["kind"];id?:string}) {
  const [params] = useSearchParams();
  const capability=useProjectsCapability();
  const projects=useProjects();
  return <Panel title="Choose a project" description={`Select a project to browse its ${kind === "task" ? "tasks and dependencies" : "knowledge records"}.`}>
    {!capability.enabled ? <div role="status"><p>Project list isn't offered by this AQ server — choose a project from the scope menu or open a project link.</p><p className={styles.meta}>Reason: {capability.reason}</p></div> :
      !projects.data ? <QueryStatus status={projects.isError?"error":"pending"} error={projects.error} label="projects" onRetry={()=>void projects.refetch()}/> :
      projects.data.view.length ? <ul className={styles.projectList}>{projects.data.view.map(p=><li key={p.id}><Link to={{pathname:pathFor(kind,id),search:(()=>{const next=new URLSearchParams(params);next.set("scope",`project:${p.id}`);return `?${next}`;})()}}>{p.label}</Link></li>)}</ul> : <p>No projects are available to this account.</p>}
  </Panel>;
}
/** Knowledge library workspace. Work renders its own task workspace (WorkWorkspace). */
export function HumanNodeWorkspace({kind}:{kind:"knowledge"}) {
  const [scope]=useScope();const id=useParams().nodeId;
  if(scope.kind !== "project")return <ProjectChoice kind={kind} id={id}/>;
  if(!validGraphId(scope.project_id) || (id && !validGraphId(id)))return <p role="status">This item does not exist or is not available to you.</p>;
  return <ProjectWorkspace key={`${scope.project_id}:${kind}`} project={scope.project_id} kind={kind} id={id}/>;
}
function ProjectWorkspace({project,kind,id}:{project:string;kind:"knowledge";id?:string}) {
  const [params,setParams]=useSearchParams();
  const [draft,setDraft]=useState(params.get("q")??"");const q=(params.get("q")??"").slice(0,256);
  const [category,setCategory]=useState("");const [lifecycle,setLifecycle]=useState("");const [verification,setVerification]=useState("");
  const query=useGraphList(project,kind,q);let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const search=params.toString()?`?${params}`:"";
  const workspace=useRef<HTMLDivElement>(null),previous=useRef<{id?:string}>({});
  useEffect(()=>{
    const before=previous.current;previous.current={id};
    const element=workspace.current;if(!element)return;
    // Selection focuses its heading; Back restores the previously selected row.
    const restore=!id?before.id:undefined;
    const focus=()=>{
      const target=id?element.querySelector<HTMLElement>(`.${styles.detail} h2`):restore?[...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a=>new URL(a.href).pathname===pathFor(kind,restore)):undefined;
      if(!target)return false;
      if(target.tagName==="H2")target.tabIndex=-1;
      target.focus();return true;
    };
    if(focus())return;
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});
    observer.observe(element,{childList:true,subtree:true});return()=>observer.disconnect();
  },[id,kind]);
  const filtered=rows.filter(n=>(!category || n.content_type===category)&&(!lifecycle || (lifecycle==="retired"?n.retired:!n.retired))&&(!verification || n.verification===verification));
  const categories=[...new Set(rows.map(n=>n.content_type).filter((v):v is string=>!!v))].sort();
  const projectName=query.data?.pages[0]?.project.name;
  // A failed or pending read has no count; never present it as "0 loaded" (spec 0002 §10).
  const listTitle=query.isError || mergeError ? "Records unavailable" : !query.data ? "Records" : `${filtered.length} records loaded`;
  const update=(key:string,value:string)=>setParams(p=>{const n=new URLSearchParams(p);if(value)n.set(key,value);else n.delete(key);return n;});
  return <div ref={workspace} className={styles.workspace} data-kind={kind} data-detail={!!id} data-view="list">
    <p className={styles.subtitle}>Find the decisions, procedures, and evidence behind the work.{projectName && <span> · {projectName}</span>}</p>
    {query.data?.pages[0] && <RecordActions record={{project:query.data.pages[0].project}} author />}
    <Toolbar className={styles.filters}>
      <form onSubmit={e=>{e.preventDefault();update("q",draft.trim());}} className={styles.search}>
        <label className="visually-hidden" htmlFor={`find-${kind}`}>Search knowledge</label>
        <input id={`find-${kind}`} type="search" maxLength={256} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Search project knowledge…"/>
        <ActionButton type="submit">Search</ActionButton>
      </form>
      <>
        <label><span className="visually-hidden">Category of loaded records</span><select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories loaded</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
        <label><span className="visually-hidden">Lifecycle of loaded records</span><select value={lifecycle} onChange={e=>setLifecycle(e.target.value)}><option value="">All lifecycle states loaded</option><option value="active">Active records</option><option value="retired">Retired records</option></select></label>
        <label><span className="visually-hidden">Verification of loaded records</span><select value={verification} onChange={e=>setVerification(e.target.value)}><option value="">Any verification loaded</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option></select></label>
      </>
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.listPane}>
      <Panel title={listTitle} actions={<ActionButton disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh list</ActionButton>}>
        {query.isError || mergeError || !query.data ? <QueryStatus status={query.isError||mergeError?"error":"pending"} error={mergeError??query.error} label="knowledge records" onRetry={()=>void query.refetch()}/> : <>
          {!filtered.length && <p>{rows.length?"No loaded records match these filters.":"No records returned for this search."}</p>}
          <ul className={styles.records} aria-label="Knowledge records">{filtered.map(n=><li key={n.id} data-selected={id===n.id}><Link className={styles.record} aria-current={id===n.id?"page":undefined} to={{pathname:pathFor(kind,n.id),search:withoutRevision(search)}}><BookOpen size={21} aria-hidden/><span><strong>{n.title}</strong><span className={styles.meta}>{n.content_type??"Uncategorized"} · {n.deleted?"Deleted":n.retired?"Retired":"Active"} · {nodeLabel(n.verification)}</span></span><span className={styles.revision}>r{n.content_revision}</span></Link></li>)}</ul>
          {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more records</ActionButton>}
          {query.data.pages.length===GRAPH_MAX_PAGES && query.data.pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
          <p className={styles.meta}>Loaded records only; this is not a project total.</p>
        </>}
      </Panel>
      </div>
      {id ? <NodeDetail key={`${id}:${params.get("revision")??"current"}`} project={project} kind={kind} id={id}/> : <Panel title="Project knowledge" className={styles.emptyInspector}><BookOpen size={34} aria-hidden/><p>Select a record to read its content and exact revision.</p></Panel>}
    </div>
  </div>;
}
function NodeDetail({project,kind,id}:{project:string;kind:"knowledge";id:string}) {
  const [params]=useSearchParams();const raw=params.get("revision");const pinned=raw && /^[1-9][0-9]{0,19}$/.test(raw)?raw:undefined;
  const query=useGraphDetail(project,kind,id,pinned);
  if(raw && !pinned)return <p role="status">This revision is not available.</p>;
  if(!query.data)return <Panel title="Record"><QueryStatus status={query.isError?"error":"pending"} error={query.error} label="this record" onRetry={()=>void query.refetch()}/></Panel>;
  const notice=query.isError?<p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={()=>void query.refetch()}>Refresh record</ActionButton></p>:undefined;
  return <KnowledgeDocument record={query.data} pinned={pinned} notice={notice}/>;
}
