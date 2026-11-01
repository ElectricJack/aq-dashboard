import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { apiGet } from "../../api/client";
import { adaptOverviewTasks, type OverviewTaskProject } from "../../api/adapters/overviewTasks";
import { scopedKey } from "../../api/queryKeys";
import { useScope, scopeSearch } from "../../app/scope";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./Overview.module.css";
const STATES = ["draft", "active", "completed", "canceled"] as const;
function Project({ row }: { row: OverviewTaskProject }) {
 const { bootstrap } = useSession();
 const search=scopeSearch({kind:"project",project_id:row.project.id});
 return <li className={styles.projectCard}>
  <div className={styles.panelHeading}><h3>{row.project.name}</h3>{bootstrap.capability("tasks.read").enabled && <Link to={{pathname:"/work",search}}>Open work →</Link>}</div>
  {row.source_status === "unavailable" ? <p className={styles.warning}>{row.reason ?? "Task records unavailable for this project"}</p> : <>
   <p className={styles.meta}>{row.count_accuracy === "lower_bound" ? "Sampled task records" : "Observed task records"} · {row.observed_at && <time dateTime={row.observed_at}>{row.observed_at}</time>}</p>
   <ul className={styles.taskCounts} aria-label={`${row.project.name} recorded task states`}>{STATES.map(state=><li key={state}><strong>{row.task_counts?.[state]}</strong> {state}</li>)}</ul>
   {row.tasks.length === 0 ? <p className={styles.meta}>No task records in this observation.</p> : <ul className={styles.taskList}>{row.tasks.slice(0,5).map(task=><li key={task.id}><span>{bootstrap.capability("tasks.read").enabled ? <Link to={{pathname:`/work/${task.id}`,search}}>{task.title}</Link> : task.title}</span><span className={styles.meta}>{task.task_state ?? "State unknown"}</span></li>)}</ul>}
   {(row.more_tasks || row.tasks.length>5) && <p className={styles.meta}>Showing a bounded selection. Open Work for more records.</p>}
  </>}
 </li>;
}
export function RecordedTasks() {
 const [scope]=useScope(); const {bootstrap,queryContext}=useSession();
 const capability=bootstrap.capability("human.overview.tasks.read");
 const project=scope.kind==="project"?scope.project_id:undefined;
 const query=useQuery({queryKey:scopedKey(queryContext,scope,"overview-task-contributions",{}),enabled:capability.enabled,retry:false,refetchInterval:30000,queryFn:async({signal})=>{
  const params=new URLSearchParams({project_limit:"4",task_limit:"16"});if(project)params.set("project_id",project);
  return adaptOverviewTasks(await apiGet<unknown>(`/api/human/overview/tasks?${params}`,signal),project);
 }});
 if(!capability.enabled)return null;
 return <section className={styles.panel} aria-labelledby="recorded-tasks-heading">
  <h2 id="recorded-tasks-heading">Recorded tasks</h2>
  <p className={styles.meta}>Observed task lifecycle, excluding retired or disputed records. Active records do not establish running agents or execution readiness.</p>
  {!query.data || query.isError ? <QueryStatus status={query.isError?"error":"pending"} error={query.error} label="project task records" onRetry={()=>void query.refetch()} /> : <>
   {query.data.projects.length===0 ? <p>No configured projects in this scope.</p> : <ul className={styles.projectList} aria-label="Project task observations">{query.data.projects.map(row=><Project row={row} key={row.project.id}/>)}</ul>}
   {query.data.coverage==="partial" && <p className={styles.meta}>Partial coverage · More records or unavailable sources may exist.</p>}
   {query.data.next_after && bootstrap.capability("tasks.read").enabled && <Link to={{pathname:"/work",search:scopeSearch(scope)}}>Browse projects in Work →</Link>}
  </>}
 </section>;
}
