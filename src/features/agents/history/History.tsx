import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { adaptSession, type SessionView } from '../../../api/adapters/inspection';
import type { Scope, SessionSummary } from '../../../api/wire/proposed';
import { useScope, scopeSearch } from '../../../app/scope';
import { PANEL_READ, useSession } from '../../../app/session';
import { usePagedRead } from '../../../app/usePagedRead';
import { ApiError, isProtectedReadFailure } from '../../../api/client';
import { listInternalRuns, type InternalRunData } from '../../../api/internalWork';
import { duration } from '../../internal/InternalRun';
import { history, type HistorySession } from '../../../api/sessionHistory';
import { sessionConversation, type ConversationSource } from '../../../api/sessionConversation';
import { Conversation } from './Conversation';
import { AgentsTabs } from '../AgentsTabs';
import { observedEnded, observedRunning } from '../labels';
import { ObservationLabel, ObservationTimes } from '../ObservationState';
import styles from './History.module.css';

function refusedRead(error:unknown) { return (error instanceof ApiError && [404,410].includes(error.status ?? 0)) || isProtectedReadFailure(error); }
function dateValue(s: string, end = false) { if (!s) return undefined; const d = new Date(`${s}T00:00:00`); if (end) d.setDate(d.getDate()+1); return Number.isFinite(d.getTime()) ? d.getTime() : undefined; }
function useHistoryFilters(initialInternal: boolean) {
  const [q, setQ] = useState(""), [provider, setProvider] = useState(""), [model, setModel] = useState("");
  const [status, setStatus] = useState(""), [from, setFrom] = useState(""), [until, setUntil] = useState("");
  const [internal, setInternal] = useState(initialInternal);
  return { q, setQ, provider, setProvider, model, setModel, status, setStatus, from, setFrom, until, setUntil, internal, setInternal };
}
type Filters = ReturnType<typeof useHistoryFilters>;

function FilterPanel({ filters }: { filters: Filters }) {
  const { q, setQ, provider, setProvider, model, setModel, status, setStatus, from, setFrom, until, setUntil, internal, setInternal } = filters;
  return <div className={styles.filters}><label className={styles.check}><input type="checkbox" checked={internal} onChange={e=>setInternal(e.target.checked)} />Internal</label>{!internal && <><label>Search sessions<input value={q} maxLength={200} onChange={e=>setQ(e.target.value)} placeholder="Name or project" /></label><div className={styles.pair}><label>Provider<input value={provider} onChange={e=>setProvider(e.target.value)} /></label><label>Model<input value={model} onChange={e=>setModel(e.target.value)} /></label></div><div className={styles.pair}><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>Through<input type="date" value={until} onChange={e=>setUntil(e.target.value)} /></label></div><label>State<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All states</option><option value="active">Active</option><option value="ended">Ended</option></select></label></>}</div>;
}

function useHistoryLists(scope: Scope, project: string | undefined, values: Filters) {
  const { queryContext } = useSession();
  const { q, provider, model, status, from, until, internal } = values;
  const filters = {project_id:project,q,provider,model,status,created_from_ms:dateValue(from),created_until_ms:dateValue(until,true),limit:50};
 const listing = useInfiniteQuery({queryKey:['history',queryContext.principalId,queryContext.authorizationRevision,filters],initialPageParam:undefined as string|undefined,enabled:!internal,queryFn:({pageParam,signal})=>history({...filters,cursor:pageParam},signal),getNextPageParam:p=>p.next_cursor ?? undefined,retry:false,meta:PANEL_READ});
 const runs = useInfiniteQuery({queryKey:['internal-runs',queryContext.principalId,queryContext.authorizationRevision],initialPageParam:undefined as string|undefined,enabled:internal,queryFn:({pageParam,signal})=>listInternalRuns({limit:50,cursor:pageParam},signal),getNextPageParam:p=>p.next_cursor ?? undefined,retry:false,meta:PANEL_READ});
 const native = usePagedRead<SessionSummary,SessionView>({resource:'history-native',path:'/api/v1/sessions',scope,params:{limit:25},adapt:adaptSession,stable:true});
  return { listing, runs, native };
}
type Lists = ReturnType<typeof useHistoryLists>;

function matchesText(value: string | null | undefined, query: string) {
  return !query || !!value?.toLowerCase().includes(query.toLowerCase());
}

function matchesNative(session: SessionView, filters: Filters) {
  const text = `${session.label} ${session.task?.title ?? ""} ${session.project.label}`;
  if (!matchesText(text, filters.q)) return false;
  if (!matchesText(session.profile.provider, filters.provider)) return false;
  if (!matchesText(session.profile.model, filters.model)) return false;
  if (!filters.status) return true;
  const state = session.observation.state;
  return filters.status === "ended" ? observedEnded(state) : observedRunning(state);
}

function permitted(query: { isError: boolean; error: unknown }) {
  return !query.isError || !isProtectedReadFailure(query.error);
}

function listedSessions({ listing, native }: Lists, filters: Filters) {
  const manual = permitted(listing) ? listing.data?.pages.flatMap(page => page.sessions) ?? [] : [];
  const nativeRows = permitted(native) ? native.data?.pages.flatMap(page => page.page.items) ?? [] : [];
  return { manual, nativeRows: nativeRows.filter(session => matchesNative(session, filters)) };
}

type Selection = { selected: string | null; choose: (value: string) => void };
function ManualRow({ session: s, selected, choose }: Selection & { session: HistorySession }) {
  return <li><button className={styles.row} data-selected={selected===`manual:${s.id}`} onClick={()=>choose(`manual:${s.id}`)}><strong>{s.spec.project_name || `Session ${s.id.slice(0,8)}`}</strong><span>{s.spec.provider} · {s.spec.model} · {s.status}</span><span>{new Date(s.created_at_ms).toLocaleString()} · {s.conversation_available ? 'Saved conversation' : 'No saved conversation'}</span></button></li>;
}
function NativeRow({ session: s, selected, choose, nativeServerTime }: Selection & { session: SessionView; nativeServerTime: string }) {
  return <li data-session-id={s.id}><button className={styles.row} data-selected={selected===`native:${s.id}`} onClick={()=>choose(`native:${s.id}`)}><strong>{s.label}</strong><span>{s.project.label} · {s.profile.provider ?? 'Provider unknown'} · <ObservationLabel session={s} /></span><ObservationTimes session={s} serverTime={nativeServerTime} /><span>Native session</span></button></li>;
}

function MoreRows({ label, query }: { label: string; query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage(): Promise<unknown> } }) {
  if (!query.hasNextPage) return null;
  return <button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{label}</button>;
}

function InternalRows({ runs }: Pick<Lists, "runs">) {
  const rows = runs.data?.pages.flatMap(page => page.runs) ?? [];
  return <>
    {runs.isError && <p role="alert">Could not load internal work. <button onClick={() => void runs.refetch()}>Retry</button></p>}
    {runs.isPending && <p>Loading internal work…</p>}
    {runs.isSuccess && !rows.length && <p>No internal work has run yet.</p>}
    <ul className={styles.rows} aria-label="Internal work">{rows.map(run => <InternalRow key={run.id} run={run} />)}</ul>
    <MoreRows label="Load more internal work" query={runs} />
  </>;
}

function ListingStatus({ listing }: Pick<Lists, "listing">) {
  const unsupported = listing.error instanceof ApiError && listing.error.status === 404;
  return <>
    {listing.isError && <p role="alert">{unsupported ? "History is not supported by this server." : "Could not load retained history."} <button onClick={() => void listing.refetch()}>Retry</button></p>}
    {listing.isPending && <p>Loading history…</p>}
  </>;
}

function SessionRows({ queries, manual, nativeRows, filters, ...selection }: Selection & ReturnType<typeof listedSessions> & { queries: Lists; filters: Filters }) {
  const { listing, native } = queries;
  const serverTime = native.data?.pages.at(-1)?.serverTime ?? new Date().toISOString();
  return <>
    <ListingStatus listing={listing} />
    <ul className={styles.rows} aria-label="Session history">
      {manual.map(session => <ManualRow key={`manual:${session.id}`} session={session} {...selection} />)}
      {nativeRows.map(session => <NativeRow key={`native:${session.id}`} session={session} nativeServerTime={serverTime} {...selection} />)}
    </ul>
    <MoreRows label="Load more history" query={listing} />
    <MoreRows label="Load more native sessions" query={native} />
    {native.isError && <p role="alert">Native sessions could not be loaded.</p>}
    {(filters.from || filters.until) && <p>Dates apply to retained manual sessions; native session dates are unavailable in this list.</p>}
  </>;
}

function SelectedSession({ selected, nativeRows, project }: { selected: string | null; nativeRows: SessionView[]; project?: string }) {
  const { queryContext } = useSession();
  const manual = selected?.startsWith("manual:") ? selected.slice(7) : null;
  if (manual) return <SessionHistory source="manual" key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${project ?? "all"}:${manual}`} id={manual} project={project} />;
  const native = selected?.startsWith("native:") ? selected.slice(7) : null;
  if (native) return <Native key={native} id={native} session={nativeRows.find(session => session.id === native)} project={project} />;
  return <p className={styles.empty}>Select a session to view its conversation.</p>;
}

export function History() {
  const [scope] = useScope(), [params, setParams] = useSearchParams();
  const filters = useHistoryFilters(params.get("internal") === "1");
  const project = scope.kind === "project" ? scope.project_id : undefined;
  const queries = useHistoryLists(scope, project, filters);
  const sessions = filters.internal ? { manual: [], nativeRows: [] } : listedSessions(queries, filters);
  const selected = params.get("session");
  function choose(id: string | null) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (id === null) next.delete("session"); else next.set("session", id);
      return next;
    });
  }
  return <><AgentsTabs current="history" /><div className={styles.layout} data-focused={!!selected}>
    <aside className={styles.roster}>
      <FilterPanel filters={filters} />
      {filters.internal ? <InternalRows runs={queries.runs} /> : <SessionRows queries={queries} filters={filters} selected={selected} choose={choose} {...sessions} />}
    </aside>
    <main className={styles.workspace}>
      {selected && <button className={styles.back} onClick={() => choose(null)}>← Sessions</button>}
      <SelectedSession selected={selected} nativeRows={sessions.nativeRows} project={project} />
    </main>
  </div></>;
}
function InternalRow({run:r}:{run:InternalRunData}) { return <li><div className={styles.row}><strong>{r.purpose.replaceAll('_',' ')}</strong><span>{r.affected.kind} {r.affected.id} · {r.status}{r.retry_of?' · retry':''}</span><span>{r.provider ? `${r.provider} · ${r.model} · ${duration(r.elapsed_ms ?? 0)}` : 'No model answered'} · {new Date(r.created_at_ms).toLocaleString()}</span></div></li>; }
function Native({ id, session, project }: { id: string; session?: SessionView; project?: string }) {
  const [scope] = useScope();
  return <>
    <div className={styles.header}>
      {session && <>
        <strong>{session.label}</strong>
        <span>{session.project.label} · {session.profile.provider ?? 'Provider unknown'}</span>
      </>}
      <Link to={{ pathname: `/agents/${encodeURIComponent(id)}`, search: scopeSearch(scope) }}>Open session inspection</Link>
    </div>
    <SessionHistory source="native" id={id} project={project} />
  </>;
}
type ConversationRequest = { source: ConversationSource; id: string; project?: string };
function useConversationRead({ source, id, project }: ConversationRequest) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: ['history-conversation', queryContext.principalId, queryContext.authorizationRevision, source, project, id],
    queryFn: ({ signal }) => sessionConversation(source, id, project, signal),
    retry: false,
    meta: PANEL_READ,
    refetchInterval: query => query.state.data?.kind === 'unavailable' ? 15000 : false,
  });
}
function SessionHistory({ source, id, project }: { source: ConversationSource; id: string; project?: string }) {
  const query = useConversationRead({ source, id, project });
  const data = query.data;
  if (query.isError && refusedRead(query.error)) return <p role="alert">This session is unavailable or access was refused.</p>;
  if (query.isPending) return <p role="status">Loading session history…</p>;
  if (data?.kind === 'outside_project') return <p role="status">This session is outside the selected project.</p>;
  if (data?.kind === "available") return <Conversation id={id} snapshot={data.conversation} />;
  if (query.isError) return <p role="alert">
    Could not load the conversation. <button onClick={() => void query.refetch()}>Retry</button>
  </p>;
  return <p className={styles.empty}>No saved conversation for this session.</p>;
}
