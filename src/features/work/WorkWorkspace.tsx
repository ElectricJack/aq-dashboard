import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { List, ListChecks, Search, Workflow } from "lucide-react";
import { PageTitle } from "../../app/DestinationPage";
import { useScope } from "../../app/scope";
import { useGraphDetail, useGraphList } from "../../api/humanGraphReads";
import { GRAPH_MAX_PAGES, mergeGraphPages, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { ProjectChoice, pathFor, withoutRevision } from "../knowledge/HumanNodeWorkspace";
import inspectorStyles from "../knowledge/HumanNodeWorkspace.module.css";
import { HumanTaskGraph } from "./graph/HumanTaskGraph";
import { HumanTaskInspector } from "./HumanTaskInspector";
import { EXECUTION_UNAVAILABLE, WORK_STATE_FILTERS, WORK_STATE_LABEL, taskRowMeta, workStateFilter } from "./labels";
import styles from "./WorkWorkspace.module.css";

/** Work destination: a task workspace (design reference 02), not a generic record inspector. */
export function WorkWorkspace({ action }: { action?: ReactNode }) {
  const [scope] = useScope();
  const id = useParams().taskId;
  if (scope.kind !== "project") return <div className={styles.page}><WorkHead action={action}/><ProjectChoice kind="task" id={id}/></div>;
  if (!validGraphId(scope.project_id) || (id && !validGraphId(id))) return <div className={styles.page}><WorkHead action={action}/><p role="status">This item does not exist or is not available to you.</p></div>;
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
  const filtered = rows.filter(n => !state || n.task_state === state);
  const search = params.toString() ? `?${params}` : "";
  const root = params.get("root");
  // With no selection the graph roots on the first loaded task, never a "pick one first" placeholder.
  const graphRoot = validGraphId(root) ? root! : id ?? filtered[0]?.id;
  const unavailable = query.isError || !!mergeError;
  // A failed or pending read has no count; never present it as "0 loaded" (spec 0002 §10).
  const listTitle = unavailable ? "Tasks unavailable" : !query.data ? "Tasks" : `${filtered.length} tasks loaded`;
  const update = (key: string, value: string) => setParams(p => {
    const n = new URLSearchParams(p);
    if (value) n.set(key, value); else n.delete(key);
    if (key === "view" && value === "graph" && id && !n.has("root")) n.set("root", id);
    return n;
  });

  const workspace = useRef<HTMLDivElement>(null), previous = useRef<{ id?: string; graph: boolean }>({ graph: false });
  useEffect(() => {
    const before = previous.current; previous.current = { id, graph };
    const element = workspace.current; if (!element) return;
    // Selection focuses its heading; Back restores the previously selected row/node.
    const restore = (!id || graph) ? before.id : undefined;
    const focus = () => {
      const target = id && !graph ? element.querySelector<HTMLElement>(`[data-work-inspector] .${inspectorStyles.detail} h2`) : restore ? [...element.querySelectorAll<HTMLAnchorElement>("a[href]")].find(a => new URL(a.href).pathname === pathFor("task", restore)) : undefined;
      if (!target) return false;
      if (target.tagName === "H2") target.tabIndex = -1;
      target.focus(); return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    observer.observe(element, { childList: true, subtree: true }); return () => observer.disconnect();
  }, [id, graph]);

  const graphPanel = graphRoot
    ? <HumanTaskGraph project={project} root={graphRoot} selected={id} search={search}/>
    : <Panel title="Dependency graph">{unavailable || !query.data
      ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/>
      : <p>{rows.length ? "No loaded tasks match this state." : "No tasks returned for this search."}</p>}</Panel>;

  return <div ref={workspace} className={styles.page} data-detail={!!id} data-view={graph ? "graph" : "list"}>
    <WorkHead action={action} project={query.data?.pages[0]?.project.name}>
      <div role="group" aria-label="Work view" className={styles.segmented}>
        <ActionButton aria-pressed={!graph} onClick={() => update("view", "")}><List size={18} aria-hidden/>List</ActionButton>
        <ActionButton aria-pressed={graph} onClick={() => update("view", "graph")}><Workflow size={18} aria-hidden/>Graph</ActionButton>
      </div>
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
        {graph ? graphPanel : <Panel title={listTitle} description={query.data && !unavailable ? EXECUTION_UNAVAILABLE : undefined} actions={<ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh list</ActionButton>}>
          {unavailable || !query.data ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/> : <>
            {!filtered.length && <p>{rows.length ? "No loaded tasks match this state." : "No records returned for this search."}</p>}
            <ul className={styles.rows} aria-label="Tasks">{filtered.map(n => <li key={n.id} data-selected={id === n.id}>
              <Link className={styles.row} aria-current={id === n.id ? "page" : undefined} to={{ pathname: pathFor("task", n.id), search: withoutRevision(search) }}>
                <ListChecks size={20} aria-hidden/><span><strong>{n.title}</strong><span className={styles.meta}>{taskRowMeta(n)}</span></span>
              </Link>
            </li>)}</ul>
            {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more tasks</ActionButton>}
            {query.data.pages.length === GRAPH_MAX_PAGES && query.data.pages.at(-1)?.data.next_cursor && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
            <p className={styles.meta}>Loaded records only; this is not a project total.</p>
          </>}
        </Panel>}
      </div>
      <div className={styles.inspector} data-work-inspector>
        {id ? <TaskDetail key={id} project={project} id={id} search={search}/> : <Panel title="Task inspector" className={styles.emptyInspector}><ListChecks size={34} aria-hidden/><p>Select a task to read its content and exact revision.</p></Panel>}
      </div>
    </div>
  </div>;
}

function TaskDetail({ project, id, search }: { project: string; id: string; search: string }) {
  const query = useGraphDetail(project, "task", id);
  if (!query.data) return <Panel title="Record"><QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this record" onRetry={() => void query.refetch()}/></Panel>;
  const notice = query.isError ? <p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={() => void query.refetch()}>Refresh record</ActionButton></p> : undefined;
  return <HumanTaskInspector record={query.data} search={withoutRevision(search)} notice={notice}/>;
}
