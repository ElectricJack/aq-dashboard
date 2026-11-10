import {useQuery} from "@tanstack/react-query";
import {Link} from "react-router";
import {useScope} from "../../app/scope";
import {useSession} from "../../app/session";
import {apiGet} from "../../api/client";
import {queryKey} from "../../api/queryKeys";
import {adaptProjectBindings, PROJECT_PAGE_SIZE} from "../../api/adapters/projectBindings";
import {validGraphId} from "../../api/adapters/humanGraph";
import {ActionButton} from "../../components/layout/Workspace";
import {ProjectControl, projectState} from "../settings/ProjectControl";
import styles from "./Overview.module.css";

/** The owner API retains at most 256 projects; keyset reads cover every selection. */
async function selectedProject(project:string,signal:AbortSignal){
  const readSignal=AbortSignal.any([signal,AbortSignal.timeout(8000)]);
  let after:string|null=null;
  for(let page=0;page<Math.ceil(256/PROJECT_PAGE_SIZE);page++){
    const params=new URLSearchParams({limit:String(PROJECT_PAGE_SIZE)});if(after)params.set("after",after);
    const result=adaptProjectBindings(await apiGet(`/api/projects?${params}`,readSignal),after);
    const found=result.items.find(p=>p.id===project);if(found)return found;
    if(!result.next)break;after=result.next;
  }
  throw Error("Project controls unavailable");
}
export function SelectedProjectControl(){
  const [scope]=useScope();const {bootstrap,queryContext}=useSession();
  const project=scope.kind==="project"?scope.project_id:null;
  const enabled=bootstrap.capability("projects.read").enabled&&validGraphId(project);
  const query=useQuery({queryKey:queryKey(queryContext,"selected-project-control",{project}),enabled,retry:false,
    queryFn:({signal})=>selectedProject(project!,signal),staleTime:0});
  if(!enabled)return null;
  if(!query.data||query.isError)return <section className={styles.projectControls} aria-label="Selected project controls">
    <p>{query.isError?"Project controls are unavailable.":"Loading project controls…"}</p>
    {query.isError&&<><ActionButton onClick={()=>void query.refetch()}>Retry project controls</ActionButton><Link to="/settings?tab=projects">Project settings</Link></>}
  </section>;
  const p=query.data;
  return <section className={styles.projectControls} aria-label="Selected project controls">
    <div><h2>{p.name} <span data-started={p.enabled&&p.workerPolicy==="enabled"||undefined}>{projectState(p)}</span></h2>
      <p>Start permits queued work to launch. Stop may interrupt running agents at their next policy check.</p></div>
    <ProjectControl key={`${p.id}:${queryContext.principalId}:${queryContext.authorizationRevision}`} project={p} onChanged={()=>query.refetch()}/>
  </section>;
}
