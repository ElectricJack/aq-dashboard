import { Link } from "react-router";
import { useGraphList } from "../../api/humanGraphReads";
import { mergeGraphPages, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { useScope, scopeSearch } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./SearchDialog.module.css";
function Group({project,kind,q,onChoose}:{project:string;kind:GraphNode["kind"];q:string;onChoose():void}) {
  const query=useGraphList(project,kind,q);
  let rows:GraphNode[]=[],mergeError:unknown;
  try{rows=mergeGraphPages(query.data?.pages??[]);}catch(e){mergeError=e;}
  const label=kind === "task"?"Tasks":"Knowledge";
  return <section className={styles.group}><h3>{label}</h3>{query.isError || mergeError || !query.data ? <QueryStatus status={query.isError||mergeError?"error":"pending"} error={mergeError??query.error} label={`${label.toLowerCase()} search results`} onRetry={()=>void query.refetch()}/> : <>
    <p className={styles.muted} role="status">{rows.length} {label.toLowerCase()} returned</p>
    <ul aria-label={label}>{rows.map(n=><li key={n.id}><Link className={styles.hit} data-search-result to={{pathname:`/${kind === "task"?"work":"knowledge"}/${encodeURIComponent(n.id)}`,search:scopeSearch({kind:"project",project_id:project})}} onClick={onChoose}><span className={styles.hitTitle}>{n.title}</span><span className={styles.muted}>{query.data.pages[0]?.project.name} · revision {n.content_revision}</span></Link></li>)}</ul>
    {query.hasNextPage && <p className={styles.muted}>More matches are available. Refine your search or browse the project.</p>}
  </>}</section>;
}
export function HumanSearchResults({q,onChoose}:{q:string;onChoose():void}) {
  const [scope]=useScope();const {bootstrap}=useSession();
  if(scope.kind !== "project" || !validGraphId(scope.project_id))return <p className={styles.muted}>Choose a project in the project selector to search its tasks and knowledge.</p>;
  return <div className={styles.results}>{bootstrap.capability("tasks.read").enabled && <Group project={scope.project_id} kind="task" q={q.slice(0,256)} onChoose={onChoose}/>} {bootstrap.capability("knowledge.read").enabled && <Group project={scope.project_id} kind="knowledge" q={q.slice(0,256)} onChoose={onChoose}/>}</div>;
}
