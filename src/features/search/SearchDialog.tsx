import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import type { CapabilityState } from "../../api/adapters/bootstrap";
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
/** AQ refuses a query longer than 256 UTF-8 bytes (aq-server dashboard_api/search.rs). */
export const MAX_QUERY_BYTES = 256;
/** AQ cuts hit titles at 256 characters; a cut title ends at a word with an ellipsis. */
const SERVER_TITLE_CHARS = 256;

/** Control characters are refused by AQ; a pasted tab or line break is a space. */
export function normalizeQuery(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

export function queryTooLong(q: string): boolean {
  return new TextEncoder().encode(q).length > MAX_QUERY_BYTES;
}

/** A title the server cut at its limit ends at the last whole word, marked with an ellipsis. */
export function displayTitle(title: string): string {
  const chars = Array.from(title);
  if (chars.length < SERVER_TITLE_CHARS) return title;
  const cut = title.replace(/\s+\S*$/, "").replace(/[\s.,;:]+$/, "");
  return `${cut || title}…`;
}

/** Work and Knowledge open a record only inside its project, so those links carry the hit's project. */
const PROJECT_ROUTES = new Set(["task", "knowledge"]);
export function hitScope(hit: { ref: { type: string }; project?: { id: string } }, scope: Scope): Scope {
  if (scope.kind === "project" || !hit.project) return scope;
  if (PROJECT_ROUTES.has(hit.ref.type)) return { kind: "project", project_id: hit.project.id };
  return scope;
}

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

type GroupProps = {
  group: Group; snapshot: string | null; q: string; scope: Scope; generation: number;
  onChoose(): void; onRestart(): void;
};

function continuedGroup(view: SearchView, group: Group, snapshot: string | null) {
  const next = view.groups.find(candidate => candidate.type === group.type);
  if (view.snapshotId !== snapshot || !next) throw new ContractError("Search continuation changed snapshot or group");
  return next;
}

function useGroupPages({ group, snapshot, q, scope, generation }: GroupProps) {
  const {queryContext}=useSession();
  return useInfiniteQuery({
    queryKey:scopedKey(queryContext,scope,'search',{q,type:group.type,snapshot,generation}),
    initialPageParam:null as string|null,
    initialData:{pages:[group],pageParams:[null]},
    enabled:false,
    queryFn: async ({ pageParam, signal }) => {
      const env = await apiGet<Envelope<SearchResults>>(readUrl("/api/v1/search", { q, types: group.type, cursor: pageParam ?? undefined }, scope), signal);
      validateReadEnvelope(env, queryContext.contractVersion, scope);
      return continuedGroup(adaptSearch(env.data), group, snapshot);
    },
    getNextPageParam:(page)=>page.hasMore?page.nextCursor??undefined:undefined,
    retry:false,
  });
}

function SearchHit({ hit, scope, onChoose }: { hit: Group["hits"][number]; scope: Scope; onChoose(): void }) {
  const path = subjectPath(hit.ref);
  const body = <>
    <span className={styles.hitTitle}>{displayTitle(hit.title)}</span>
    <span className={styles.muted}>{hit.project?.label}{hit.project && hit.excerpt && " · "}{hit.excerpt}</span>
  </>;
  return <li>{path ? <Link to={{ pathname: path, search: scopeSearch(hitScope(hit, scope)) }} className={styles.hit} onClick={onChoose} data-search-result>{body}</Link>
    : <span className={styles.hit}>{body}</span>}</li>;
}

function uniqueHits(pages: Group[]) {
  const hits = pages.flatMap(page => page.hits);
  return [...new Map(hits.map(hit => [JSON.stringify(hit.ref), hit])).values()];
}

function SearchGroup(props: GroupProps) {
  const { group, scope, onChoose, onRestart } = props;
  const query = useGroupPages(props);
  const label = GROUP_LABEL[group.type] ?? "Other results";
  const hits = uniqueHits(query.data.pages);
  const expired=query.error instanceof ApiError&&query.error.status===410;
  // Empty groups are noise; the dialog says when nothing matched at all.
  const hasContent = hits.length > 0 || group.hasMore;
  if (!hasContent && !query.isError) return null;
  return <section className={styles.group}>
    <h3 id={`search-group-${group.type}`}>{label}</h3>
    {expired?<p role="alert" className={styles.warning}>Search snapshot expired. <button type="button" className={styles.close} onClick={onRestart}>Restart search</button></p>:<>
    <ul aria-labelledby={`search-group-${group.type}`}>
      {hits.map(hit => <SearchHit key={JSON.stringify(hit.ref)} hit={hit} scope={scope} onChoose={onChoose} />)}
    </ul>
    {query.isError?<QueryStatus status="error" error={query.error} label={`${label.toLowerCase()} continuation`} onRetry={()=>void query.fetchNextPage()}/>:query.hasNextPage?<button type="button" className={styles.close} disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{query.isFetchingNextPage?'Loading…':`More ${label.toLowerCase()}`}</button>:group.hasMore&&!group.nextCursor&&<p className={styles.muted}>More {label.toLowerCase()} match. Refine your search.</p>}
    </>}
  </section>;
}

type ResultsProps = { q: string; onChoose(): void; onRestart(): void; generation: number };
function Results(props: ResultsProps) {
  const { q, onRestart } = props;
  const [scope]=useScope();
  const query=useRead<SearchResults,SearchView>({resource:'search',path:'/api/v1/search',scope,params:{q},adapt:adaptSearch});
  if(!query.data)return <QueryStatus status={query.isError?'error':'pending'} error={query.error} label="search results" onRetry={()=>void query.refetch()}/>;
  const { view, coverage } = query.data;
  const complete = coverage.state === "complete" && !query.isError && view.sources.every(source => source.coverage.state === "complete");
  return <SearchMatches {...props} view={view} complete={complete} scope={scope} onRestart={() => { void query.refetch().then(onRestart); }} />;
}

function SearchMatches({ view, complete, scope, q, onChoose, onRestart, generation }: ResultsProps & {
  view: SearchView; complete: boolean; scope: Scope;
}) {
  const count=view.groups.reduce((n,g)=>n+g.hits.length,0);
  if(count===0&&!view.groups.some(g=>g.hasMore))return <p className={complete?styles.muted:styles.warning} role="status">{complete?`No matches for “${q}”`:'No matches in the projects that responded; results may be incomplete.'}</p>;
  return <div className={styles.results}>
    <p className="visually-hidden" role="status">{count} result{count===1?'':'s'} in the first page</p>
    {!complete&&<p className={styles.warning}>Some sources did not respond; results may be incomplete.</p>}
    {view.groups.map(group=><SearchGroup key={JSON.stringify([q,scope,view.snapshotId,group.type,generation])} group={group} snapshot={view.snapshotId} generation={generation} q={q} scope={scope} onChoose={onChoose} onRestart={onRestart}/>)}
  </div>;
}

function searchTargets(dialog: HTMLDialogElement | null, input: HTMLInputElement | null) {
  const results = dialog?.querySelectorAll<HTMLAnchorElement>("[data-search-result]") ?? [];
  return [input, ...results].filter((target): target is HTMLInputElement | HTMLAnchorElement => !!target);
}

function useSearchFocus(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
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
    const items = searchTargets(dialog.current, input.current);
    const index = items.indexOf(document.activeElement as HTMLInputElement | HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0);
    items[next]?.focus();
    e.preventDefault();
  }

  return { dialog, input, onKeyDown, close: () => dialog.current?.close() };
}

function SearchBody({ capability, tooLong, legacyGraph, ...results }: ResultsProps & {
  capability: CapabilityState; tooLong: boolean; legacyGraph: boolean;
}) {
  if (!capability.enabled) return <p className={styles.muted}>{capability.reason}</p>;
  if (tooLong) return <p id="search-too-long" className={styles.warning} role="alert">Search is limited to {MAX_QUERY_BYTES} characters. Shorten your search.</p>;
  if (queryTooLong(results.q)) return null;
  if (results.q.length < MIN_CHARS) return <p className={styles.muted}>Type at least {MIN_CHARS} characters to search.</p>;
  if (legacyGraph) return <HumanSearchResults q={results.q} onChoose={results.onChoose} />;
  return <Results {...results} />;
}

function legacyGraphSearch(bootstrap: ReturnType<typeof useSession>["bootstrap"], contractVersion: string) {
  if (import.meta.env.MODE !== "test" && import.meta.env.MODE !== "mock") return false;
  if (contractVersion === "dashboard-read-1") return false;
  return bootstrap.capability("human.graph.read").enabled;
}

/** One search surface for the button, Ctrl/⌘+K and touch (docs/specs/0002 §3). */
export function SearchDialog({ onClose }: { onClose(): void }) {
  const { dialog, input, onKeyDown, close } = useSearchFocus(onClose);
  const [text, setText] = useState("");
  const normalized = normalizeQuery(text);
  const q = useDebounced(normalized, DEBOUNCE_MS);
  const tooLong = queryTooLong(normalized);
  const { bootstrap, queryContext } = useSession();
  const legacyGraph = legacyGraphSearch(bootstrap, queryContext.contractVersion);
  const capability = bootstrap.capability("search.read");
  const [generation,setGeneration]=useState(0);

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
          placeholder="Search tasks, results, knowledge and more…"
          aria-invalid={tooLong || undefined}
          aria-describedby={tooLong ? "search-too-long" : undefined}
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className={styles.close} onClick={close}>
          Close search
        </button>
      </div>
      <div className={styles.body}>
        <SearchBody capability={capability} tooLong={tooLong} legacyGraph={legacyGraph}
          q={q} generation={generation} onRestart={() => setGeneration(n => n + 1)} onChoose={close} />
      </div>
    </dialog>
  );
}
