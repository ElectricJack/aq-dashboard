import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { adaptSearch, type SearchView } from "../../api/adapters/inspection";
import type { Envelope, Scope } from "../../api/wire/proposed";
import type { Search as SearchResults } from "../../api/wire/overview";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "../../api/client";
import { ContractError } from "../../api/adapters/contract";
import { validateReadEnvelope } from "../../api/adapters/envelope";
import { scopedKey } from "../../api/queryKeys";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { scopeSearch, useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { subjectPath } from "../../app/subjects";
import { readUrl, useRead } from "../../app/useRead";
import { HumanSearchResults } from "./HumanSearchResults";
import styles from "./SearchDialog.module.css";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

const GROUP_LABEL: Record<string, string> = {
  task: "Tasks",
  session: "Sessions",
  result: "Results",
  playbook: "Playbooks",
  knowledge: "Knowledge",
};

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Group = SearchView['groups'][number];

function SearchGroup({ group, snapshot, q, scope, generation, onChoose, onRestart }: { group:Group; snapshot:string|null; q:string; scope:Scope; generation:number; onChoose():void; onRestart():void }) {
  const {queryContext}=useSession();
  const search=scopeSearch(scope);
  const label=GROUP_LABEL[group.type]??'Other results';
  const query=useInfiniteQuery({
    queryKey:scopedKey(queryContext,scope,'search',{q,type:group.type,snapshot,generation}),
    initialPageParam:null as string|null,
    initialData:{pages:[group],pageParams:[null]},
    enabled:false,
    queryFn:async({pageParam,signal})=>{
      const env=await apiGet<Envelope<SearchResults>>(readUrl('/api/v1/search',{q,types:group.type,cursor:pageParam??undefined},scope),signal);
      validateReadEnvelope(env,queryContext.contractVersion,scope);
      const view=adaptSearch(env.data);
      const next=view.groups.find(g=>g.type===group.type);
      if(view.snapshotId!==snapshot||!next)throw new ContractError('Search continuation changed snapshot or group');
      return next;
    },
    getNextPageParam:(page)=>page.hasMore?page.nextCursor??undefined:undefined,
    retry:false,
  });
  const hits=[...new Map(query.data.pages.flatMap(page=>page.hits).map(hit=>[JSON.stringify(hit.ref),hit])).values()];
  const expired=query.error instanceof ApiError&&query.error.status===410;
  return <section className={styles.group}>
    <h3 id={`search-group-${group.type}`}>{label}</h3>
    {expired?<p role="alert" className={styles.warning}>Search snapshot expired. <button type="button" className={styles.close} onClick={onRestart}>Restart search</button></p>:<>
    <ul aria-labelledby={`search-group-${group.type}`}>
      {hits.map(h=>{
        const path=subjectPath(h.ref);
        const body=<><span className={styles.hitTitle}>{h.title}</span><span className={styles.muted}>{h.project?.label}{h.project&&h.excerpt&&' · '}{h.excerpt}</span></>;
        return <li key={JSON.stringify(h.ref)}>{path?<Link to={{pathname:path,search}} className={styles.hit} onClick={onChoose} data-search-result>{body}</Link>:<span className={styles.hit}>{body}</span>}</li>;
      })}
    </ul>
    {query.isError?<QueryStatus status="error" error={query.error} label={`${label.toLowerCase()} continuation`} onRetry={()=>void query.fetchNextPage()}/>:query.hasNextPage?<button type="button" className={styles.close} disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?'Loading…':`More ${label.toLowerCase()}`}</button>:group.hasMore&&!group.nextCursor&&<p className={styles.muted}>More {label.toLowerCase()} match. Refine your search.</p>}
    </>}
  </section>;
}

function Results({ q, onChoose, onRestart, generation }: { q:string; onChoose():void; onRestart():void; generation:number }) {
  const [scope]=useScope();
  const query=useRead<SearchResults,SearchView>({resource:'search',path:'/api/v1/search',scope,params:{q},adapt:adaptSearch});
  if(!query.data)return <QueryStatus status={query.isError?'error':'pending'} error={query.error} label="search results" onRetry={()=>void query.refetch()}/>;
  const {view,coverage}=query.data;
  const complete=coverage.state==='complete'&&!query.isError&&view.sources.every(s=>s.coverage.state==='complete');
  const count=view.groups.reduce((n,g)=>n+g.hits.length,0);
  if(count===0&&!view.groups.some(g=>g.hasMore))return <p className={complete?styles.muted:styles.warning} role="status">{complete?`No matches for “${q}”`:'No matches in the projects that responded; results may be incomplete.'}</p>;
  return <div className={styles.results}>
    <p className="visually-hidden" role="status">{count} result{count===1?'':'s'} in the first page</p>
    {!complete&&<p className={styles.warning}>Some sources did not respond; results may be incomplete.</p>}
    {view.groups.map(group=><SearchGroup key={JSON.stringify([q,scope,view.snapshotId,group.type,generation])} group={group} snapshot={view.snapshotId} generation={generation} q={q} scope={scope} onChoose={onChoose} onRestart={()=>{void query.refetch().then(onRestart);}}/>)}
  </div>;
}

/** One search surface for the button, Ctrl/⌘+K and touch (docs/specs/0002 §3). */
export function SearchDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), DEBOUNCE_MS);
  const { bootstrap, queryContext } = useSession();
  const legacyGraph = (import.meta.env.MODE === "test" || import.meta.env.MODE === "mock") && queryContext.contractVersion !== "dashboard-read-1" && bootstrap.capability("human.graph.read").enabled;
  const capability = bootstrap.capability("search.read");
  const [generation,setGeneration]=useState(0);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    input.current?.focus();
    const closed = () => onClose();
    el.addEventListener("close", closed);
    return () => el.removeEventListener("close", closed);
  }, [onClose]);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [
      input.current,
      ...(dialog.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? []),
    ].filter((x): x is HTMLInputElement | HTMLAnchorElement => !!x);
    const index = items.indexOf(document.activeElement as HTMLInputElement | HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    items[next]?.focus();
    e.preventDefault();
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="search-title" onKeyDown={onKeyDown}>
      <div className={styles.header}>
        <h2 id="search-title" className="visually-hidden">
          Search
        </h2>
        <input
          ref={input}
          type="search"
          aria-label="Search"
          placeholder="Search tasks and sessions…"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>
          Close search
        </button>
      </div>
      <div className={styles.body}>
        {!capability.enabled ? (
          <p className={styles.muted}>{capability.reason}</p>
        ) : q.length < MIN_CHARS ? (
          <p className={styles.muted}>Type at least {MIN_CHARS} characters to search.</p>
        ) : (
          legacyGraph ? <HumanSearchResults q={q} onChoose={() => dialog.current?.close()} /> : <Results q={q} generation={generation} onRestart={()=>setGeneration(n=>n+1)} onChoose={() => dialog.current?.close()} />
        )}
      </div>
    </dialog>
  );
}
