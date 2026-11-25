import {RecordList} from "./RecordList";
import {pathFor,withoutRevision} from "./recordRoutes";
import {useNodeWorkspace,type NodeLocation} from "./useNodeWorkspace";
import { Link, useParams, useSearchParams } from "react-router";
import {BookOpen} from "lucide-react";
import {RecordToolbar} from "./RecordToolbar";
import { useScope } from "../../app/scope";
import { PageHeader } from "../../components/layout/PageHeader";
import { useProjects, useProjectsCapability } from "../../app/useProjects";
import { useGraphList, useGraphDetail } from "../../api/humanGraphReads";
import { validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { KnowledgeDocument } from "./KnowledgeDocument";
import { AddRecordAction } from "./KnowledgeActions";
import { HumanTaskInspector, TaskInspectorUnavailable } from "../work/HumanTaskInspector";
import styles from "./HumanNodeWorkspace.module.css";

export {pathFor,withoutRevision} from "./recordRoutes";
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
/**
 * Knowledge page header (reference 07): H1 with "Add record" on the same row and one subtitle.
 * The action slot stays in place in every state; the project name belongs to scope and document meta.
 */
function KnowledgeHeader() {
  const [scope]=useScope();const [params]=useSearchParams();
  const project=scope.kind==="project" && validGraphId(scope.project_id) ? scope.project_id : "";
  // Same query key as the library list, so this shares its cache and adds no request.
  const list=useGraphList(project,"knowledge",(params.get("q")??"").slice(0,256));
  const pending=!project?"Choose a project first":list.isError?"Project records are unavailable":"Loading project records";
  return <PageHeader title="Knowledge" actions={<AddRecordAction project={list.data?.pages[0]?.project} pendingReason={pending}/>} />;
}
export function HumanNodeWorkspace({kind}:{kind:GraphNode["kind"]}) {
  const [scope]=useScope();const route=useParams();const [params]=useSearchParams();const id=kind === "task" ? route.taskId : route.nodeId;
  const missing=<p role="status">This item does not exist or is not available to you.</p>;
  const body=scope.kind !== "project" ? <ProjectChoice kind={kind} id={id}/> :
    !validGraphId(scope.project_id) || (id && !validGraphId(id)) ? (kind==="task"&&validGraphId(scope.project_id)?<TaskInspectorUnavailable search={withoutRevision(`?${params}`)} status={missing}/>:missing) :
    <ProjectWorkspace key={`${scope.project_id}:${kind}`} project={scope.project_id} kind={kind} id={id}/>;
  return kind==="knowledge" ? <><KnowledgeHeader/>{body}</> : body;
}
function ProjectWorkspace(route:NodeLocation) {
  const {kind,id,project}=route;
  const model=useNodeWorkspace(route);
  const {params,workspace,search,graph,projectName}=model;
  return <div ref={workspace} className={styles.workspace} data-kind={kind} data-detail={!!id} data-view={graph?"graph":"list"}>
    {kind==="task" && <p className={styles.subtitle}>Inspect project tasks and their recorded dependencies.{projectName && <span> · {projectName}</span>}</p>}
    <RecordToolbar model={model} kind={kind}/>
    <div className={styles.panes}>
      <div className={styles.listPane}>
        <RecordList model={model} route={route}/>
      </div>
      {id ? <NodeDetail key={`${id}:${params.get("revision")??"current"}`} project={project} kind={kind} id={id} search={search}/> : <Panel title={kind==="knowledge"?"Project knowledge":"Task inspector"} className={styles.emptyInspector}><BookOpen size={34} aria-hidden/><p>Select a {kind==="task"?"task":"record"} to read its content and exact revision.</p></Panel>}
    </div>
  </div>;
}
function NodeDetail({project,kind,id,search}:{project:string;kind:GraphNode["kind"];id:string;search:string}) {
  const [params]=useSearchParams();const raw=kind==="knowledge"?params.get("revision"):null;
  const pinned=raw && /^[1-9][0-9]{0,19}$/.test(raw)?raw:undefined;
  const query=useGraphDetail(project,kind,id,pinned);
  if(raw && !pinned)return <p role="status">This revision is not available.</p>;
  if(!query.data) return <MissingDetail query={query} kind={kind} search={search}/>;
  const notice=query.isError?<p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={()=>void query.refetch()}>Refresh record</ActionButton></p>:undefined;
  return kind === "task" ? <HumanTaskInspector className={styles.detail} record={query.data} search={withoutRevision(search)} notice={notice}/> : <KnowledgeDocument record={query.data} pinned={pinned} notice={notice}/>;
}


function MissingDetail({query,kind,search}:{query:ReturnType<typeof useGraphDetail>;kind:GraphNode["kind"];search:string}) {
 const status=<QueryStatus status={query.isError?"error":"pending"} error={query.error} label="this record" onRetry={()=>void query.refetch()}/>;
 if (kind==="task")return <TaskInspectorUnavailable className={styles.detail} search={withoutRevision(search)} status={status} busy={!query.isError}/>;
 return <Panel title="Record">{status}</Panel>;
}
