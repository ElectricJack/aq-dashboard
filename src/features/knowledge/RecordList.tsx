import {type ReactNode} from "react";
import {Link} from "react-router";
import {ListChecks,RefreshCw} from "lucide-react";
import {GRAPH_MAX_PAGES,nodeLabel,type GraphNode} from "../../api/adapters/humanGraph";
import {ActionButton,Panel} from "../../components/layout/Workspace";
import {QueryStatus} from "../../components/QueryStatus/QueryStatus";
import {Icon,knowledgeCategoryIcon} from "../../components/icons";
import {knowledgeCategoryLabel as categoryLabel} from "../actions/actionClient";
import {HumanTaskGraph,PhoneGraphView,graphListTarget} from "../work/graph/HumanTaskGraph";
import {pathFor,withoutRevision} from "./recordRoutes";
import {lifecycleOf,LIFECYCLE_LABEL,type NodeWorkspace,type NodeLocation} from "./useNodeWorkspace";
import styles from "./HumanNodeWorkspace.module.css";
/** Short UTC calendar date ("Oct 28"), matching the document header; the exact instant stays in the title. */
function shortDate(value:string) {
  const date=new Date(value),now=new Date();
  return date.toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC",...(date.getUTCFullYear()!==now.getUTCFullYear()?{year:"numeric"}:{})});
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

/** Phone graph without a selected task: open the dedicated view on the root (or first loaded task) instead of a dead end. */
function PhoneTaskGraph({project,root,search,status,error,onRetry}:{project:string;root?:string;search:string;status?:"error"|"pending";error:unknown;onRetry:()=>void}) {
  if(root)return <HumanTaskGraph project={project} root={root} search={search}/>;
  return <PhoneGraphView backTo={graphListTarget(search)}><div className={styles.phoneGraphStatus}>{status ? <QueryStatus status={status} error={error} label="tasks" onRetry={onRetry}/> : <p>No loaded tasks to show in a graph.</p>}</div></PhoneGraphView>;
}

type ListProps={model:NodeWorkspace;route:NodeLocation};
function ListActions({model}:{model:NodeWorkspace}){
 const {knowledge,sort,setFilter,query}=model;
 return knowledge ? <div className={styles.listActions}>
          <label><span className="visually-hidden">Sort records</span><select value={sort} onChange={e=>setFilter("sort",e.target.value,"updated")}><option value="updated">Updated recently</option><option value="title">Title A–Z</option></select></label>
          <ActionButton className={styles.iconButton} aria-label="Refresh list" title="Refresh list" disabled={query.isFetching} onClick={()=>void query.refetch()}><Icon icon={RefreshCw} size={18}/></ActionButton>
        </div> : <ActionButton disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh list</ActionButton>;
}
function RecordRows({model,route}:ListProps){
 const {kind,id}=route;
 const {filtered,search,knowledge}=model;
 return <ul className={styles.records} aria-label={kind==="task"?"Tasks":"Knowledge records"}>{filtered.map(n=><li key={n.id} data-selected={id===n.id}><Link className={styles.record} aria-current={id===n.id?"page":undefined} to={{pathname:pathFor(kind,n.id),search:withoutRevision(search)}}>{knowledge ? <KnowledgeRow node={n}/> : <><ListChecks size={21} aria-hidden/><span><strong>{n.title}</strong><span className={styles.meta}>{nodeLabel(n.task_state)} · {LIFECYCLE_LABEL[lifecycleOf(n)]} · {nodeLabel(n.verification)}</span></span><span className={styles.revision}>r{n.content_revision}</span></>}</Link></li>)}</ul>;
}
function LoadedRecords({model,route}:ListProps){
 const {kind}=route;
 const {filtered,emptyText,query,knowledge}=model;
 const pages=query.data!.pages;
 return <>          {!filtered.length && <p>{emptyText}</p>}
          <RecordRows model={model} route={route}/>
          {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>Load more {kind==="task"?"tasks":"records"}</ActionButton>}
          {pages.length===GRAPH_MAX_PAGES && pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
          <p className={styles.meta}>{knowledge?"Filters and counts cover loaded records only; this is not a project total.":"Loaded records only; this is not a project total."}</p>
</>;
}
function GraphView({model,route}:ListProps){
 const {phone,graphRoot,filtered,search,query,mergeError,update,state}=model;
 const {id,project}=route;
 if (id) return <HumanTaskGraph project={project} root={graphRoot!} selected={id} search={search}/>;
 if (phone) return <PhoneTaskGraph project={project} root={graphRoot??filtered[0]?.id} search={search} status={state} error={mergeError??query.error} onRetry={()=>void query.refetch()}/>;
 return <Panel title="Dependency graph"><p>Select a task from the list to open its neighborhood.</p><ActionButton onClick={()=>update("view","")}>Choose a task</ActionButton></Panel>;
}
export function RecordList({model,route}:ListProps){
 const {graph,listTitle,state,mergeError,query}=model;
 if (graph) return <GraphView model={model} route={route}/>;
 return <Panel title={listTitle} className={styles.listPanel} actions={<ListActions model={model}/>}>
   {state ? <QueryStatus status={state} error={mergeError??query.error} label={route.kind==="task"?"tasks":"knowledge records"} onRetry={()=>void query.refetch()}/>
     : <LoadedRecords model={model} route={route}/>}
 </Panel>;
}
