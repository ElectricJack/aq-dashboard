import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { apiGet } from "../../api/client";
import { adaptOverviewWorkers } from "../../api/adapters/overviewWorkers";
import { adaptPage, adaptSession, type SessionView } from "../../api/adapters/inspection";
import { queryKey } from "../../api/queryKeys";
import type { Page, SessionSummary } from "../../api/wire/proposed";
import { useSession } from "../../app/session";
import { useScope, scopeSearch } from "../../app/scope";
import { useRead } from "../../app/useRead";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./Overview.module.css";
function Sessions() {
 const [scope]=useScope();const {bootstrap}=useSession();
 const capability=bootstrap.capability("sessions.read");
 const query=useRead<Page<SessionSummary>,SessionView[]>({resource:"overview-session-snapshots",path:"/api/v1/sessions",scope,params:{limit:4},enabled:capability.enabled,adapt:(p,clock)=>adaptPage(p,item=>adaptSession(item,clock)).items,pollMs:15000});
 return <section className={styles.panel} aria-labelledby="overview-sessions-heading"><div className={styles.panelHeading}><h2 id="overview-sessions-heading">Sessions</h2>{capability.enabled&&<Link to={{pathname:"/agents",search:scopeSearch(scope)}}>View all →</Link>}</div>
 {!capability.enabled?<p className={styles.meta}>{capability.reason}</p>:!query.data||query.isError?<QueryStatus status={query.isError?"error":"pending"} error={query.error} label="session snapshots" onRetry={()=>void query.refetch()}/>:query.data.view.length===0?<p className={styles.meta}>No session records in this scope.</p>:<ul className={styles.snapshotList}>{query.data.view.map(session=><li key={session.id}><Link to={{pathname:`/agents/${session.id}`,search:scopeSearch(scope)}}>{session.label}</Link><span className={styles.meta}>{session.observation.state==="reported_running"?"Running (reported)":session.observation.state==="reported_stopped"?"Stopped (reported)":"Process observation unknown"}</span>{session.observation.freshness === "stale" && <span className={styles.meta}>Stale observation</span>}{session.lifecycle?.stoppedAt&&<span className={styles.meta}>Stop recorded</span>}</li>)}</ul>}
 </section>;
}
export function Infrastructure() {
 const {bootstrap,queryContext}=useSession();
 const capability=bootstrap.capability("workers.read");
 const workers=useQuery({queryKey:queryKey(queryContext,"overview-worker-heartbeats",{}),enabled:capability.enabled,retry:false,refetchInterval:15000,queryFn:async({signal})=>adaptOverviewWorkers(await apiGet<unknown>("/api/workers",signal))});
 return <aside className={styles.secondary} aria-label="Infrastructure observations">
 <section className={styles.panel} aria-labelledby="overview-capacity-heading">
 <h2 id="overview-capacity-heading">Capacity</h2><p className={styles.capacityValue}>Not reported</p>
 <p className={styles.meta}>Slot capacity and project eligibility are not reported here.</p>
 <section className={styles.infrastructureSection} aria-labelledby="overview-workers-heading"><h3 id="overview-workers-heading">Worker nodes</h3>
 {!capability.enabled?<p className={styles.meta}>{capability.reason}</p>:!workers.data||workers.isError?<QueryStatus status={workers.isError?"error":"pending"} error={workers.error} label="worker heartbeats" onRetry={()=>void workers.refetch()}/>:<>
 <p className={styles.meta}>{workers.data.length} enrolled worker records · installation-wide</p>
 {workers.data.length===0?<p className={styles.meta}>No enrolled worker records.</p>:<details className={styles.observationDetails}><summary>Inspect heartbeat observations</summary><ul className={styles.snapshotList}>{workers.data.slice(0,4).map(worker=><li key={worker.id}><strong>{worker.name}</strong><span className={styles.meta}>{worker.status==="online"?"Heartbeat online":worker.status==="offline"?"Heartbeat offline":worker.status==="revoked"?"Revoked":"Heartbeat state unknown"}</span>{worker.last_seen_at&&<time className={styles.meta} dateTime={worker.last_seen_at}>{worker.last_seen_at}</time>}</li>)}</ul>{workers.data.length>4&&<p className={styles.meta}>Showing 4 of {workers.data.length} workers.</p>}</details>}
 </>}
 </section>
 <section className={styles.infrastructureSection} aria-labelledby="overview-provider-heading"><h3 id="overview-provider-heading">Provider status</h3><p className={styles.meta}>Availability not reported.</p></section>
 <Link to="/settings">Inspect configuration →</Link>
 </section>
 <Sessions/>
 </aside>;
}
