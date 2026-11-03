import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { apiGet } from "../../api/client";
import { adaptOverviewWorkers } from "../../api/adapters/overviewWorkers";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { PinnedSessions } from "./PinnedSessions";
import { adaptConfiguredProviders, configuredAccountLabel, configuredAccountStatus } from "../../api/adapters/configuredProviders";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./Overview.module.css";
export function Infrastructure() {
 const {bootstrap,queryContext}=useSession();
 const [scope]=useScope();
 const configuredCapability=bootstrap.capability('providers.configured.read');
 const configured=useQuery({queryKey:queryKey(queryContext,'configured-provider-accounts',{contract:'human-provider-accounts-1'}),enabled:configuredCapability.enabled,retry:false,refetchInterval:60000,queryFn:async({signal})=>adaptConfiguredProviders(await apiGet<unknown>('/api/human/provider-accounts',signal))});
 const capability=bootstrap.capability("workers.read");
 const workers=useQuery({queryKey:queryKey(queryContext,"overview-worker-heartbeats",{}),enabled:capability.enabled,retry:false,refetchInterval:15000,queryFn:async({signal})=>adaptOverviewWorkers(await apiGet<unknown>("/api/workers",signal))});
 return <aside className={styles.secondary} aria-label="Infrastructure observations">
 <section className={styles.panel} aria-labelledby="overview-capacity-heading">
 <h2 id="overview-capacity-heading">Capacity</h2><p className={styles.capacityValue}>Slots unavailable</p><p className={styles.meta}>Occupied: unknown · Idle: unknown</p>
 <p className={styles.meta}>Slot capacity and project eligibility are not reported here.</p>
 <section className={styles.infrastructureSection} aria-labelledby="overview-workers-heading"><h3 id="overview-workers-heading">Worker nodes</h3>
 {!capability.enabled?<p className={styles.meta}>{capability.reason}</p>:!workers.data||workers.isError?<QueryStatus status={workers.isError?"error":"pending"} error={workers.error} label="worker heartbeats" onRetry={()=>void workers.refetch()}/>:<>
 <p className={styles.meta}>{workers.data.length} enrolled worker records · installation-wide</p>
 {workers.data.length===0?<p className={styles.meta}>No enrolled worker records.</p>:<details className={styles.observationDetails}><summary>Inspect heartbeat observations</summary><ul className={styles.snapshotList}>{workers.data.slice(0,4).map(worker=><li key={worker.id}><strong>{worker.name}</strong><span className={styles.meta}>{worker.status==="online"?"Heartbeat online":worker.status==="offline"?"Heartbeat offline":worker.status==="revoked"?"Revoked":"Heartbeat state unknown"}</span>{worker.last_seen_at&&<time className={styles.meta} dateTime={worker.last_seen_at}>{worker.last_seen_at}</time>}</li>)}</ul>{workers.data.length>4&&<p className={styles.meta}>Showing 4 of {workers.data.length} workers.</p>}</details>}
 </>}
 </section>
 <section className={styles.infrastructureSection} aria-labelledby="overview-provider-heading"><h3 id="overview-provider-heading">Provider status</h3><p className={styles.meta}>Availability not reported.</p>
 {configuredCapability.enabled && (!configured.data||configured.isError?<QueryStatus status={configured.isError?'error':'pending'} label="provider accounts" error={configured.error} onRetry={()=>void configured.refetch()}/>:<><ul className={styles.snapshotList}>{configured.data.accounts.map(account=><li key={JSON.stringify([account.provider,account.account_reference])}><strong>{configuredAccountLabel(account)}</strong><span className={styles.meta}>{configuredAccountStatus(account)}</span></li>)}</ul><p className={styles.meta}>Startup configuration; authentication and availability are not checked.</p></>)}
 </section>
 <Link to="/settings">Inspect configuration →</Link>
 </section>
 <PinnedSessions key={JSON.stringify([queryContext,scope])}/>
 </aside>;
}
