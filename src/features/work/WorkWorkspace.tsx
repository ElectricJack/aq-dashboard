import { useEffect, useRef, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { ChartGantt, List, ListChecks } from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { useGraphDetail, useGraphList } from "../../api/humanGraphReads";
import { GRAPH_MAX_PAGES, GRAPH_PAGE_SIZE, mergeGraphPages, validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { ProjectChoice, pathFor, withoutRevision } from "../knowledge/HumanNodeWorkspace";
import inspectorStyles from "../knowledge/HumanNodeWorkspace.module.css";
import { useMediaQuery } from "../../components/useMediaQuery";
import { HumanTaskGraph, PHONE_QUERY, PhoneGraphView, graphListTarget } from "./graph/HumanTaskGraph";
import { DependencyGantt } from "./gantt/DependencyGantt";
import { GANTT_POLL_MS } from "./gantt/ganttData";
import { HumanTaskInspector, TaskInspectorUnavailable } from "./HumanTaskInspector";
import { listStatus, recordMarker, workStateFilter } from "./labels";
import { StatusIcon } from "./StatusIcon";
import { AllProjectWorkList } from "./AllProjectWorkList";
import { WorkFilters } from "./WorkFilters";
import { useTaskWork } from "./taskWork";
import styles from "./WorkWorkspace.module.css";

/** Work destination: a task workspace (design reference 02), not a generic record inspector. */
export function WorkWorkspace({ action }: { action?: ReactNode }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const id = useParams().taskId;
  const [params] = useSearchParams();
  if (scope.kind !== "project") {
    if (params.get("view") === "gantt") {
      const taskProject = params.get("taskProject");
      const selected = validGraphId(id) && validGraphId(taskProject) ? id : undefined;
      return <TaskWorkspace key="all" id={selected} detailProject={selected ? taskProject! : undefined} action={action}/>;
    }
    const allProjects = bootstrap.capability("human.work.tasks.read").enabled;
    if (allProjects && id) {
      const listParams = new URLSearchParams(params);
      for (const name of ["view", "root", "focus", "revision", "taskProject"]) listParams.delete(name);
      return <Navigate to={{ pathname: "/work", search: listParams.toString() }} replace/>;
    }
    return <div className={styles.page} data-view="list">
      <WorkHead action={action}/>
      {allProjects ? <AllProjectWorkList views={<WorkView/>}/> : <>
        <Toolbar className={styles.toolbar}><WorkView/></Toolbar>
        <ProjectChoice kind="task" id={id}/>
      </>}
    </div>;
  }
  const missing = <p role="status">This item does not exist or is not available to you.</p>;
  // A malformed task id inside a valid project still offers the "All tasks" exit (WK-E).
  if (!validGraphId(scope.project_id)) return <div className={styles.page}><WorkHead action={action}/>{missing}</div>;
  if (id && !validGraphId(id)) return <div className={styles.page}><WorkHead action={action}/><TaskInspectorUnavailable search={withoutRevision(`?${params}`)} status={missing}/></div>;
  return <TaskWorkspace key={scope.project_id} project={scope.project_id} id={id} action={action}/>;
}

function WorkHead({ action, project, children }: { action?: ReactNode; project?: string; children?: ReactNode }) {
  return <PageHeader title="Work" actions={action}>
    {project && <span><span className="visually-hidden">Project: </span>{project}</span>}{children}
  </PageHeader>;
}

function WorkView() {
  const [params, setParams] = useSearchParams();
  const showGantt = params.get("view") === "gantt" || params.get("view") === "graph";
  function changeView(gantt: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (gantt) next.set("view", "gantt");
      else {
        next.delete("view");
        const taskProject = next.get("taskProject");
        if (!next.has("scope") && validGraphId(taskProject)) next.set("scope", `project:${taskProject}`);
        next.delete("taskProject");
      }
      next.delete("root");
      next.delete("focus");
      return next;
    });
  }
  return <nav aria-label="Work view" className={styles.segmented}>
    <ActionButton aria-pressed={!showGantt} onClick={() => changeView(false)}><List size={18} aria-hidden />List</ActionButton>
    <ActionButton aria-pressed={showGantt} onClick={() => changeView(true)}><ChartGantt size={18} aria-hidden />Gantt</ActionButton>
  </nav>;
}

function TaskWorkspace({ project, detailProject = project, id, action }: { project?: string; detailProject?: string; id?: string; action?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 256);
  const state = workStateFilter(params.get("state"));
  const graph = params.get("view") === "graph";
  const gantt = params.get("view") === "gantt";
  const openOnly = state === "open" && !graph && !gantt;
  const query = useGraphList(gantt ? "" : project ?? "", "task", q, openOnly);
  let rows: GraphNode[] = [], mergeError: unknown;
  try { rows = mergeGraphPages(query.data?.pages ?? [], openOnly); } catch (e) { mergeError = e; }
  // The attempt status per held task: an ended attempt that still holds the task reads as held, not running (P1-01).
  const held = new Map((query.data?.pages ?? []).flatMap(page => page.data.executions.map(e => [e.task_id, e.status] as const)));
  // The inspected task's work read (shared with the inspector, no extra request): its row follows AQ's `held`.
  const selectedWork = useTaskWork(detailProject ?? "", id ?? "", gantt ? GANTT_POLL_MS : undefined).data?.data;
  // Expand (spec 0004 §3): the inspector takes the full width; `?focus=1` keeps it linkable across reloads.
  const focused = !!id && params.get("focus") === "1";
  const filtered = openOnly ? rows.slice(0, GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE) : state === "all" || state === "open" ? rows : rows.filter(n => n.task_state === state);
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
  const stacked = useMediaQuery("(max-width: 999px)");
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
      const preventScroll = gantt && !stacked;
      target.focus({ preventScroll, ...(arrival ? { focusVisible: false } : {}) } as FocusOptions);
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    observer.observe(element, { childList: true, subtree: true }); return () => observer.disconnect();
  }, [id, graph, gantt, phone, stacked]);

  const graphStatus = unavailable || !query.data
    ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/>
    : <p>{rows.length ? "No loaded tasks match this state." : "No tasks returned for this search."}</p>;
  // Phone keeps the dedicated full-viewport graph view (with Back to list) even before a root is known (WK-F).
  const graphPanel = graphRoot
    && project ? <HumanTaskGraph project={project} root={graphRoot} selected={id} search={search}/>
    : phone ? <PhoneGraphView backTo={graphListTarget(search)}><div className={styles.phoneGraphStatus}>{graphStatus}</div></PhoneGraphView>
    : <Panel title="Dependency graph">{graphStatus}</Panel>;

  return <div ref={workspace} className={styles.page} data-detail={!!id} data-view={gantt ? "gantt" : graph ? "graph" : "list"} data-focus={focused || undefined}>
    <WorkHead action={action} project={query.data?.pages[0]?.project.name} />
    <Toolbar className={styles.toolbar}>
      <WorkView/>
      <WorkFilters q={q} state={state} onChange={update} allProjects={!project} gantt={gantt}/>
      {graph && <div className={styles.graphActions} data-work-graph-actions/>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.mainPane}>
        {gantt ? <Panel title="Dependency tracks">
          <DependencyGantt project={project} selected={id} search={search} focused={focused}/>
        </Panel> : graph ? graphPanel : <Panel title={listTitle} actions={<ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh list</ActionButton>}>
          {unavailable || !query.data ? <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()}/> : <>
            {!filtered.length && <p>{openOnly && query.hasNextPage ? "No open tasks on these pages. Load more to continue." : rows.length ? "No loaded tasks match this state." : "No records returned for this search."}</p>}
            {/* One line per task (spec 0004 item 16): the bullet carries the status, the title truncates and shows in full on hover. */}
            <ul className={styles.rows} aria-label="Tasks">{filtered.map(n => { const marker = recordMarker(n); return <li key={n.id} data-selected={id === n.id}>
              <Link className={styles.row} aria-current={id === n.id ? "page" : undefined} title={n.title} to={{ pathname: pathFor("task", n.id), search: withoutRoot(withoutRevision(search)) }}>
                <StatusIcon status={listStatus(n, held.get(n.id), id === n.id ? selectedWork?.reported : undefined)}/><span className={styles.rowTitle}>{n.title}</span>{marker && <span className={styles.marker}>{marker}</span>}
              </Link>
            </li>; })}</ul>
            {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more tasks</ActionButton>}
            {(rows.length > filtered.length && openOnly || !query.hasNextPage && query.data.pages.at(-1)?.data.next_cursor) && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
            <p className={styles.meta}>Loaded records only; this is not a project total.</p>
          </>}
        </Panel>}
      </div>
      {(!gantt || id) && <div className={styles.inspector} data-work-inspector>
        {id && detailProject ? <>
          {gantt && <Link className={styles.closeTask} to={{ pathname: "/work", search: withoutFocus(search) }} preventScrollReset>Close task</Link>}
          <TaskDetail key={id} project={detailProject} id={id} search={search} focused={focused} pollMs={gantt ? GANTT_POLL_MS : undefined} onFocus={on => update("focus", on ? "1" : "")}/></> : !gantt && <Panel title="Task inspector" className={styles.emptyInspector}><ListChecks size={34} aria-hidden/><p>Select a task to read its content and exact revision.</p></Panel>}
      </div>}
    </div>
  </div>;
}

function withoutFocus(search: string) {
  const params = new URLSearchParams(withoutRevision(search));
  params.delete("focus");
  params.delete("taskProject");
  return `?${params}`;
}

/** List rows drop the root used by legacy graph links. */
function withoutRoot(search: string) {
  const params = new URLSearchParams(search);
  params.delete("root");
  const value = params.toString();
  return value ? `?${value}` : "";
}

function TaskDetail({ project, id, search, focused, pollMs, onFocus }: { project: string; id: string; search: string; focused: boolean; pollMs?: number; onFocus(on: boolean): void }) {
  const query = useGraphDetail(project, "task", id, undefined, pollMs);
  // A missing or pending task keeps the "All tasks" exit; aria-busy keeps focus off its placeholder heading (WK-E).
  if (!query.data) return <TaskInspectorUnavailable className={inspectorStyles.detail} search={withoutRevision(search)} busy={!query.isError}
    status={<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this record" onRetry={() => void query.refetch()}/>}/>;
  const notice = query.isError ? <p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={() => void query.refetch()}>Refresh record</ActionButton></p> : undefined;
  const params = new URLSearchParams(withoutRevision(search));
  if (params.has("taskProject")) {
    params.set("scope", `project:${project}`);
    params.delete("taskProject");
  }
  return <HumanTaskInspector className={inspectorStyles.detail} record={query.data} search={params.size ? `?${params}` : ""} notice={notice} focused={focused} onFocus={onFocus}/>;
}
