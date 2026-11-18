import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { adaptSession, type SessionView } from '../../../api/adapters/inspection';
import type { SessionSummary } from '../../../api/wire/proposed';
import { useScope, scopeSearch } from '../../../app/scope';
import { PANEL_READ, useSession } from '../../../app/session';
import { usePagedRead } from '../../../app/usePagedRead';
import { ApiError, isProtectedReadFailure } from '../../../api/client';
import { listInternalRuns, type InternalRunData } from '../../../api/internalWork';
import { duration } from '../../internal/InternalRun';
import { history } from '../../../api/sessionHistory';
import { sessionConversation } from '../../../api/sessionConversation';
import { Conversation } from './Conversation';
import { AgentsTabs } from '../AgentsTabs';
import styles from './History.module.css';

function refusedRead(error:unknown) { return (error instanceof ApiError && [404,410].includes(error.status ?? 0)) || isProtectedReadFailure(error); }
function dateValue(s: string, end = false) { if (!s) return undefined; const d = new Date(`${s}T00:00:00`); if (end) d.setDate(d.getDate()+1); return Number.isFinite(d.getTime()) ? d.getTime() : undefined; }
export function History() {
 const [scope] = useScope(); const {queryContext} = useSession(); const [params,setParams] = useSearchParams();
 const [q,setQ]=useState(''),[provider,setProvider]=useState(''),[model,setModel]=useState(''),[status,setStatus]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[internal,setInternal]=useState(()=>params.get('internal')==='1');
 const project = scope.kind === 'project' ? scope.project_id : undefined;
 const filters = {project_id:project,q,provider,model,status,created_from_ms:dateValue(from),created_until_ms:dateValue(until,true),limit:50};
 const listing = useInfiniteQuery({queryKey:['history',queryContext.principalId,queryContext.authorizationRevision,filters],initialPageParam:undefined as string|undefined,enabled:!internal,queryFn:({pageParam,signal})=>history({...filters,cursor:pageParam},signal),getNextPageParam:p=>p.next_cursor ?? undefined,retry:false,meta:PANEL_READ});
 const runs = useInfiniteQuery({queryKey:['internal-runs',queryContext.principalId,queryContext.authorizationRevision],initialPageParam:undefined as string|undefined,enabled:internal,queryFn:({pageParam,signal})=>listInternalRuns({limit:50,cursor:pageParam},signal),getNextPageParam:p=>p.next_cursor ?? undefined,retry:false,meta:PANEL_READ});
 const native = usePagedRead<SessionSummary,SessionView>({resource:'history-native',path:'/api/v1/sessions',scope,params:{limit:25},adapt:adaptSession,stable:true});
 const selected = params.get('session'); const choose=(value:string)=>setParams(p=>{const n=new URLSearchParams(p); n.set('session',value);return n;});
 const internalRows = internal ? runs.data?.pages.flatMap(p=>p.runs) ?? [] : [];
 const manual = internal ? [] : listing.isError && isProtectedReadFailure(listing.error) ? [] : listing.data?.pages.flatMap(p=>p.sessions) ?? [];
 const nativeRows = internal ? [] : (native.isError && isProtectedReadFailure(native.error) ? [] : native.data?.pages.flatMap(p=>p.page.items) ?? []).filter(s=>{const text=`${s.label} ${s.task?.title ?? ''} ${s.project.label}`.toLowerCase(); return (!q || text.includes(q.toLowerCase())) && (!provider || s.profile.provider?.toLowerCase().includes(provider.toLowerCase())) && (!model || (s.profile.model ?? '').toLowerCase().includes(model.toLowerCase())) && (!status || (status==='ended' ? s.observation.state==='reported_stopped' : s.observation.state==='reported_running'));});
 const activeNative = selected?.startsWith('native:') ? nativeRows.find(s=>`native:${s.id}`===selected) : undefined;
 const manualId = selected?.startsWith('manual:') ? selected.slice(7) : null;
 return <><AgentsTabs current="history" /><div className={styles.layout} data-focused={!!selected}><aside className={styles.roster}><div className={styles.filters}><label className={styles.check}><input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)} />Internal</label>{!internal && <><label>Search sessions<input value={q} maxLength={200} onChange={e=>setQ(e.target.value)} placeholder="Name or project" /></label><div className={styles.pair}><label>Provider<input value={provider} onChange={e=>setProvider(e.target.value)} /></label><label>Model<input value={model} onChange={e=>setModel(e.target.value)} /></label></div><div className={styles.pair}><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>Through<input type="date" value={until} onChange={e=>setUntil(e.target.value)} /></label></div><label>State<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All states</option><option value="active">Active</option><option value="ended">Ended</option></select></label></>}</div>
 {internal && runs.isError && <p role="alert">Could not load internal work. <button onClick={()=>void runs.refetch()}>Retry</button></p>}
 {internal && runs.isPending && <p>Loading internal work…</p>}
 {internal && runs.isSuccess && !internalRows.length && <p>No internal work has run yet.</p>}
 {!internal && listing.isError && <p role="alert">{listing.error instanceof ApiError && listing.error.status===404 ? 'History is not supported by this server.' : 'Could not load retained history.'} <button onClick={()=>void listing.refetch()}>Retry</button></p>}
 {!internal && listing.isPending && <p>Loading history…</p>}
 <ul className={styles.rows} aria-label={internal?"Internal work":"Session history"}>{internalRows.map(r=><InternalRow key={r.id} run={r} />)}{manual.map(s=><li key={`manual:${s.id}`}><button className={styles.row} data-selected={selected===`manual:${s.id}`} onClick={()=>choose(`manual:${s.id}`)}><strong>{s.spec.project_name || `Session ${s.id.slice(0,8)}`}</strong><span>{s.spec.provider} · {s.spec.model} · {s.status}</span><span>{new Date(s.created_at_ms).toLocaleString()} · {s.conversation_available ? 'Saved conversation' : 'No saved conversation'}</span></button></li>)}
 {nativeRows.map(s=><li key={`native:${s.id}`}><button className={styles.row} data-selected={selected===`native:${s.id}`} onClick={()=>choose(`native:${s.id}`)}><strong>{s.label}</strong><span>{s.project.label} · {s.profile.provider ?? 'Provider unknown'} · {s.observation.state.replaceAll('_',' ')}</span><span>Native session</span></button></li>)}</ul>
 {internal && runs.hasNextPage && <button onClick={()=>void runs.fetchNextPage()} disabled={runs.isFetchingNextPage}>Load more internal work</button>}{!internal && listing.hasNextPage && <button onClick={()=>void listing.fetchNextPage()} disabled={listing.isFetchingNextPage}>Load more history</button>}{!internal && native.hasNextPage && <button onClick={()=>void native.fetchNextPage()} disabled={native.isFetchingNextPage}>Load more native sessions</button>}{!internal && native.isError && <p role="alert">Native sessions could not be loaded.</p>}{!internal && (from || until) && <p>Dates apply to retained manual sessions; native session dates are unavailable in this list.</p>}</aside>
 <main className={styles.workspace}>{selected && <button className={styles.back} onClick={()=>setParams(p=>{const n=new URLSearchParams(p);n.delete("session");return n;})}>← Sessions</button>}{manualId ? <ManualHistory key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project ?? "all"}:${manualId}`} id={manualId} project={project}/> : activeNative ? <Native session={activeNative} /> : <p className={styles.empty}>Select a session to view its conversation.</p>}</main></div></>;
}
function InternalRow({run:r}:{run:InternalRunData}) { return <li><div className={styles.row}><strong>{r.purpose.replaceAll('_',' ')}</strong><span>{r.affected.kind} {r.affected.id} · {r.status}{r.retry_of?' · retry':''}</span><span>{r.provider ? `${r.provider} · ${r.model} · ${duration(r.elapsed_ms ?? 0)}` : 'No model answered'} · {new Date(r.created_at_ms).toLocaleString()}</span></div></li>; }
function Native({session:s}:{session:SessionView}) { const [scope]=useScope(); return <><div className={styles.header}><strong>{s.label}</strong><span>{s.project.label} · {s.profile.provider ?? 'Provider unknown'}</span></div><p className={styles.notice}>No saved conversation for this session.</p><Link to={{pathname:`/agents/${encodeURIComponent(s.id)}`,search:scopeSearch(scope)}}>Open session inspection</Link></>; }
function ManualHistory({ id, project }: { id: string; project?: string }) {
  const { queryContext } = useSession();
  const query = useQuery({
    queryKey: ['history-conversation', queryContext.principalId, queryContext.authorizationRevision, project, id],
    queryFn: ({ signal }) => sessionConversation(id, project, signal),
    retry: false,
    meta: PANEL_READ,
    refetchInterval: query => query.state.data?.kind === 'unavailable' ? 15000 : false,
  });
  if (query.isError && refusedRead(query.error)) return <p role="alert">This session is unavailable or access was refused.</p>;
  if (query.isPending) return <p role="status">Loading session history…</p>;
  if (query.data?.kind === 'outside_project') return <p role="status">This session is outside the selected project.</p>;
  if (query.isError && query.data?.kind !== 'available') return <p role="alert">
    Could not load the conversation. <button onClick={() => void query.refetch()}>Retry</button>
  </p>;
  if (query.data?.kind !== 'available') return <p className={styles.empty}>No saved conversation for this session.</p>;
  return <Conversation id={id} snapshot={query.data.conversation} />;
}
