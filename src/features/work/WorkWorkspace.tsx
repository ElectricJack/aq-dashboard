import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { List, ListChecks, Search, Workflow } from "lucide-react";
import { PageTitle } from "../../app/DestinationPage";
import { useScope } from "../../app/scope";
import { useGraphDetail, useGraphList } from "../../api/humanGraphReads";
import { GRAPH_MAX_PAGES, heldTasks, mergeGraphPages, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { ProjectChoice, pathFor, withoutRevision } from "../knowledge/HumanNodeWorkspace";
import inspectorStyles from "../knowledge/HumanNodeWorkspace.module.css";
import { useMediaQuery } from "../../components/useMediaQuery";
import { HumanTaskGraph, PHONE_QUERY, PhoneGraphView, graphListTarget } from "./graph/HumanTaskGraph";
import { HumanTaskInspector, TaskInspectorUnavailable } from "./HumanTaskInspector";
import { WORK_STATE_FILTERS, WORK_STATE_LABEL, listStatus, recordMarker, workStateFilter } from "./labels";
import { StatusIcon } from "./StatusIcon";
import styles from "./WorkWorkspace.module.css";

/** Work destination: a task workspace (design reference 02), not a generic record inspector. */
export function WorkWorkspace({ action }: { action?: ReactNode }) {
  const [scope] = useScope();
  const id = useParams().taskId;
  const [params] = useSearchParams();
  if (scope.kind !== "project") return <div className={styles.page}><WorkHead action={action}/><ProjectChoice kind="task" id={id}/></div>;
  const missing = <p role="status">This item does not exist or is not available to you.</p>;
  // A malformed task id inside a valid project still offers the "All tasks" exit (WK-E).
  if (!validGraphId(scope.project_id)) return <div className={styles.page}><WorkHead action={action}/>{missing}</div>;
  if (id && !validGraphId(id)) return <div className={styles.page}><WorkHead action={action}/><TaskInspectorUnavailable search={withoutRevision(`?${params}`)} status={missing}/></div>;
  return <TaskWorkspace key={scope.project_id} project={scope.project_id} id={id} action={action}/>;
}

function WorkHead({ action, project, children }: { action?: ReactNode; project?: string; children?: ReactNode }) {
  return <header className={styles.head}>
    <div className={styles.titleBlock}>
      {project && <p className={styles.crumb}><span className="visually-hidden">Project: </span>{project}</p>}
      <PageTitle>Work</PageTitle>
      {children}
    </div>
    {action && <div className={styles.headAction}>{action}</div>}
  </header>;
}

function TaskWorkspace({ project, id, action }: { project: string; id?: string; action?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 256);
  const [draft, setDraft] = useState(q);
  const state = workStateFilter(params.get("state"));
  const graph = params.get("view") === "graph";
  const query = useGraphList(project, "task", q);
  let rows: GraphNode[] = [], mergeError: unknown;
  try { rows = mergeGraphPages(query.data?.pages ?? []); } catch (e) { mergeError = e; }
  const held = heldTasks(query.data?.pages ?? []);
  // Expand (spec 0004 §3): the inspector takes the full width; `?focus=1` keeps it linkable across reloads.
  const focused = !!id && params.get("focus") === "1";
  const filtered = rows.filter(n => !state || n.task_state === state);
  const search = params.toString() ? `?${params}` : "";
  const root = params.get("root");
  // With no selection the graph roots on the first loaded task, never a "pick one first" placeholder.
  const graphRoot = validGraphId(root) ? root! : id ?? filtered[0]?.id;
  const unavailable = query.isError || !!mergeError;
  // A failed or pending read has no count; never present it as "0 loaded" (spec 0002 §10).
  const listTitle = unavailable ? "Tasks unavailable" : !query.data ? "Tasks" : `${filtered.length} ${filtered.length===1?"task":"tasks"} loaded`;
  const update = (key: string, value: string) => setParams(p => {
    const n = new URLSearchParams(p);
    if (value) n.set(key, value); else n.delete(key);
    // The graph root belongs to one graph visit: List drops it, and opening Graph re-roots on the selection (WD-01).
    if (key === "view" && !value) n.delete("root");
    if (key === "view" && value === "graph" && id) n.set("root", id);
    return n;
  });
  // Esc restores the split, unless a dialog, menu or field is handling the key.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("dialog,[role=menu],input,textarea,select,[contenteditable=true]")) return;
      update("focus", "");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const phone = useMediaQuery(PHONE_QUERY);
  const workspace = useRef<HTMLDivElement>(null), previous = useRef<{ id?: string; graph: boolean }>({ graph: false }), mounted = useRef(false);
  useEffect(() => {
    const before = previous.current; previous.current = { id, graph };
    // A deep link focuses the heading for screen readers without drawing a focus ring on arrival.
    // (A StrictMode re-run repeats the same selection, so it is still an arrival.)
    const arrival = !mounted.current || (before.id === id && before.graph === graph); mounted.current = true;
    const element = workspace.current; if (!element) return;
    // Selection focuses its loaded heading; Back restores the previously selected row/node.
    // Phone graph: a node tap keeps the graph open, so focus stays on the tapped node.
    const restore = phone && graph && before.graph && id ? id : (!id || graph) ? before.id : undefined;
    const focus = () => {
      const target = id && !graph ? element.querySelector<HTMLElement>(`[data-work-inspector] .${inspectorStyles.detail}:not([aria-busy=true]) h2[data-inspector-title]`) : restore ? [...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a => new URL(a.href).pathname === pathFor("task", restore)) : undefined;
      if (!target) return false;
      if (target.tagName === "H2") target.tabIndex = -1;
      target.focus(arrival ? { focusVisible: false } as FocusOptions : undefined); return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    observer.observe(element, { childList: true, subtree: true }); return () => observer.disconnect();
  }, [id, graph, phone]);

  const graphStatus = unavailable || !query.data
    ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/>
    : <p>{rows.length ? "No loaded tasks match this state." : "No tasks returned for this search."}</p>;
  // Phone keeps the dedicated full-viewport graph view (with Back to list) even before a root is known (WK-F).
  const graphPanel = graphRoot
    ? <HumanTaskGraph project={project} root={graphRoot} selected={id} search={search}/>
    : phone ? <PhoneGraphView backTo={graphListTarget(search)}><div className={styles.phoneGraphStatus}>{graphStatus}</div></PhoneGraphView>
    : <Panel title="Dependency graph">{graphStatus}</Panel>;

  return <div ref={workspace} className={styles.page} data-detail={!!id} data-view={graph ? "graph" : "list"} data-focus={focused || undefined}>
    <WorkHead action={action} project={query.data?.pages[0]?.project.name}>
      <nav aria-label="Work view" className={styles.segmented}>
        <ActionButton aria-pressed={!graph} onClick={() => update("view", "")}><List size={18} aria-hidden/>List</ActionButton>
        <ActionButton aria-pressed={graph} onClick={() => update("view", "graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton>
      </nav>
    </WorkHead>
    <Toolbar className={styles.toolbar}>
      <form role="search" className={styles.search} onSubmit={e => { e.preventDefault(); update("q", draft.trim()); }}>
        <label className="visually-hidden" htmlFor="find-task">Search tasks</label>
        <Search size={18} aria-hidden className={styles.searchIcon}/>
        <input id="find-task" type="search" enterKeyHint="search" maxLength={256} value={draft} placeholder="Find tasks in this project…"
          onChange={e => { setDraft(e.target.value); if (!e.target.value && q) update("q", ""); }}/>
      </form>
      <div role="group" aria-label="Task state" className={styles.chips}>
        {WORK_STATE_FILTERS.map(s => <button key={s} type="button" className={styles.chip} data-state={s} aria-pressed={state === s} onClick={() => update("state", state === s ? "" : s)}>{WORK_STATE_LABEL[s]}</button>)}
      </div>
      {graph && <div className={styles.graphActions} data-work-graph-actions/>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.mainPane}>
        {graph ? graphPanel : <Panel title={listTitle} actions={<ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh list</ActionButton>}>
          {unavailable || !query.data ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/> : <>
            {!filtered.length && <p>{rows.length ? "No loaded tasks match this state." : "No records returned for this search."}</p>}
            {/* One line per task (spec 0004 item 16): the bullet carries the status, the title truncates and shows in full on hover. */}
            <ul className={styles.rows} aria-label="Tasks">{filtered.map(n => { const marker = recordMarker(n); return <li key={n.id} data-selected={id === n.id}>
              <Link className={styles.row} aria-current={id === n.id ? "page" : undefined} title={n.title} to={{ pathname: pathFor("task", n.id), search: withoutRoot(withoutRevision(search)) }}>
                <StatusIcon status={listStatus(n, held.has(n.id))}/><span className={styles.rowTitle}>{n.title}</span>{marker && <span className={styles.marker}>{marker}</span>}
              </Link>
            </li>; })}</ul>
            {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more tasks</ActionButton>}
            {query.data.pages.length === GRAPH_MAX_PAGES && query.data.pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
            <p className={styles.meta}>Loaded records only; this is not a project total.</p>
          </>}
        </Panel>}
      </div>
      <div className={styles.inspector} data-work-inspector>
        {id ? <TaskDetail key={id} project={project} id={id} search={search} focused={focused} onFocus={on => update("focus", on ? "1" : "")}/> : <Panel title="Task inspector" className={styles.emptyInspector}><ListChecks size={34} aria-hidden/><p>Select a task to read its content and exact revision.</p></Panel>}
      </div>
    </div>
  </div>;
}

/** List rows never carry a graph root: the next Graph visit roots on the row's task. */
function withoutRoot(search: string) {
  const params = new URLSearchParams(search);
  params.delete("root");
  const value = params.toString();
  return value ? `?${value}` : "";
}

function TaskDetail({ project, id, search, focused, onFocus }: { project: string; id: string; search: string; focused: boolean; onFocus(on: boolean): void }) {
  const query = useGraphDetail(project, "task", id);
  // A missing or pending task keeps the "All tasks" exit; aria-busy keeps focus off its placeholder heading (WK-E).
  if (!query.data) return <TaskInspectorUnavailable className={inspectorStyles.detail} search={withoutRevision(search)} busy={!query.isError}
    status={<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this record" onRetry={() => void query.refetch()}/>}/>;
  const notice = query.isError ? <p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={() => void query.refetch()}>Refresh record</ActionButton></p> : undefined;
  return <HumanTaskInspector className={inspectorStyles.detail} record={query.data} search={withoutRevision(search)} notice={notice} focused={focused} onFocus={onFocus}/>;
}
