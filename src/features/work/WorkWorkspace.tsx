import type { ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { ChartGantt, List, ListChecks } from "lucide-react";
import { PageHeader } from "../../components/layout/PageHeader";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { useGraphDetail } from "../../api/humanGraphReads";
import { validGraphId, type GraphNode } from "../../api/adapters/humanGraph";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { ProjectChoice, pathFor, withoutRevision } from "../knowledge/HumanNodeWorkspace";
import inspectorStyles from "../knowledge/HumanNodeWorkspace.module.css";
import { useMediaQuery } from "../../components/useMediaQuery";
import { HumanTaskGraph, PHONE_QUERY, PhoneGraphView, graphListTarget } from "./graph/HumanTaskGraph";
import { DependencyGantt } from "./gantt/DependencyGantt";
import { GANTT_POLL_MS } from "./gantt/ganttData";
import { HumanTaskInspector, TaskInspectorUnavailable } from "./HumanTaskInspector";
import { listStatus, recordMarker } from "./labels";
import { StatusIcon } from "./StatusIcon";
import { AllProjectWorkList } from "./AllProjectWorkList";
import { useSelectionFocus } from "./useSelectionFocus";
import { IncomingWorkspaceRequests } from "./resources/IncomingWorkspaceRequests";
import { WorkFilters } from "./WorkFilters";
import { useTaskWorkspaceModel, type WorkSpaceProps, type Model } from "./useTaskWorkspaceModel";
import styles from "./WorkWorkspace.module.css";

/** Work destination: a task workspace (design reference 02), not a generic record inspector. */
export function WorkWorkspace({ action }: { action?: ReactNode }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const id = useParams().taskId;
  const [params] = useSearchParams();
  if (scope.kind !== "project") return allProjectsWorkspace({ action, id, params, allProjects: bootstrap.capability("human.work.tasks.read").enabled });
  const missing = <p role="status">This item does not exist or is not available to you.</p>;
  // A malformed task id inside a valid project still offers the "All tasks" exit (WK-E).
  if (!validGraphId(scope.project_id)) return <div className={styles.page}><WorkHead action={action}/>{missing}</div>;
  if (id && !validGraphId(id)) return <div className={styles.page}><WorkHead action={action}/><TaskInspectorUnavailable search={withoutRevision(`?${params}`)} status={missing}/></div>;
  return <TaskWorkspace key={scope.project_id} project={scope.project_id} id={id} action={action}/>;
}

function allProjectsWorkspace({ action, id, params, allProjects }: {
  action?: ReactNode; id?: string; params: URLSearchParams; allProjects: boolean;
}) {
  if (params.get("view") === "gantt") {
    const taskProject = params.get("taskProject");
    const selected = validGraphId(id) && validGraphId(taskProject) ? id : undefined;
    return <TaskWorkspace key="all" id={selected} detailProject={selected ? taskProject! : undefined} action={action}/>;
  }
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

function WorkHead({ action, project, children }: { action?: ReactNode; project?: string; children?: ReactNode }) {
  return <PageHeader title="Work" actions={action}>
    {project && <span><span className="visually-hidden">Project: </span>{project}</span>}{children}
  </PageHeader>;
}

function workViewParams(previous: URLSearchParams, gantt: boolean) {
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
}

function WorkView() {
  const [params, setParams] = useSearchParams();
  const showGantt = params.get("view") === "gantt" || params.get("view") === "graph";
  function changeView(gantt: boolean) {
    setParams(previous => workViewParams(previous, gantt));
  }
  return <nav aria-label="Work view" className={styles.segmented}>
    <ActionButton aria-pressed={!showGantt} onClick={() => changeView(false)}><List size={18} aria-hidden />List</ActionButton>
    <ActionButton aria-pressed={showGantt} onClick={() => changeView(true)}><ChartGantt size={18} aria-hidden />Gantt</ActionButton>
  </nav>;
}

function pendingList(model: Model) {
  const { query, unavailable, mergeError } = model;
  if (!unavailable && query.data) return null;
  return <QueryStatus status={unavailable ? "error" : "pending"} error={mergeError ?? query.error} label="tasks" onRetry={() => void query.refetch()} />;
}

function GraphPanel({ model, phone }: { model: Model; phone: boolean }) {
  const { rows, graphRoot, project, id, search } = model;
  const graphStatus = pendingList(model) ?? <p>{rows.length ? "No loaded tasks match this state." : "No tasks returned for this search."}</p>;
  // Phone keeps the dedicated full-viewport graph view (with Back to list) even before a root is known (WK-F).
  return graphRoot
    && project ? <HumanTaskGraph project={project} root={graphRoot} selected={id} search={search}/>
    : phone ? <PhoneGraphView backTo={graphListTarget(search)}><div className={styles.phoneGraphStatus}>{graphStatus}</div></PhoneGraphView>
    : <Panel title="Dependency graph">{graphStatus}</Panel>;
}

function listTitle(model: Model) {
  if (model.unavailable) return "Tasks unavailable";
  if (!model.query.data) return "Tasks";
  const count = model.filtered.length;
  return `${count} ${count === 1 ? "task" : "tasks"} loaded`;
}
function ListPanel({ model }: { model: Model }) {
  const { query } = model;
  return <Panel title={listTitle(model)} actions={<ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh list</ActionButton>}>
    {pendingList(model) ?? <LoadedRows model={model} />}
  </Panel>;
}
function emptyListMessage({ openOnly, query, rows }: Model) {
  if (openOnly && query.hasNextPage) return "No open tasks on these pages. Load more to continue.";
  if (rows.length) return "No loaded tasks match this state.";
  return "No records returned for this search.";
}

function listCapped({ query, filtered, openOnly, rows }: Model) {
  if (openOnly && rows.length > filtered.length) return true;
  if (query.hasNextPage) return false;
  return !!query.data?.pages.at(-1)?.data.next_cursor;
}

function LoadedRows({ model }: { model: Model }) {
  const { query, filtered } = model;
  return <>
    {!filtered.length && <p>{emptyListMessage(model)}</p>}
    <TaskRows model={model} />
    {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more tasks</ActionButton>}
    {listCapped(model) && <p className={styles.meta}>Showing at most 100 records. Refine your search for more.</p>}
    <p className={styles.meta}>Loaded records only; this is not a project total.</p>
  </>;
}

function TaskRow({ node, model }: { node: GraphNode; model: Model }) {
  const selected = model.id === node.id;
  const marker = recordMarker(node);
  const held = model.held.get(node.id);
  const reported = selected ? model.selectedWork?.reported : undefined;
  const link = { pathname: pathFor("task", node.id), search: withoutRoot(withoutRevision(model.search)) };
  return <li data-selected={selected}>
    <Link className={styles.row} aria-current={selected ? "page" : undefined} title={node.title} to={link}>
      <StatusIcon status={listStatus(node, held, reported)} />
      <span className={styles.rowTitle}>{node.title}</span>
      {marker && <span className={styles.marker}>{marker}</span>}
    </Link>
  </li>;
}

function TaskRows({ model }: { model: Model }) {
  return <ul className={styles.rows} aria-label="Tasks">
    {model.filtered.map(node => <TaskRow key={node.id} node={node} model={model} />)}
  </ul>;
}

function InspectorPane({ model }: { model: Model }) {
  const { gantt, id, detailProject, search, focused, update } = model;
  if (gantt && !id) return null;
  return <div className={styles.inspector} data-work-inspector>
        {id && detailProject ? <>
          {gantt && <Link className={styles.closeTask} to={{ pathname: "/work", search: withoutFocus(search) }} preventScrollReset>Close task</Link>}
          <TaskDetail key={id} project={detailProject} id={id} search={search} focused={focused} pollMs={gantt ? GANTT_POLL_MS : undefined} onFocus={on => update("focus", on ? "1" : "")}/></> : !gantt && <Panel title="Task inspector" className={styles.emptyInspector}><ListChecks size={34} aria-hidden/><p>Select a task to read its content and exact revision.</p></Panel>}
      </div>;
}

function MainPane({ model, phone }: { model: Model; phone: boolean }) {
  if (model.gantt) return <Panel title="Dependency tracks">
    <DependencyGantt project={model.project} selected={model.id} search={model.search} focused={model.focused} />
  </Panel>;
  if (model.graph) return <GraphPanel model={model} phone={phone} />;
  return <ListPanel model={model} />;
}

function TaskWorkspace(props: WorkSpaceProps) {
  const model = useTaskWorkspaceModel(props);
  const { action } = props;
  const { q, state, query, graph, gantt, project, id, focused, update } = model;
  const phone = useMediaQuery(PHONE_QUERY);
  const workspace = useSelectionFocus({ id, graph, gantt, phone });
  return <div ref={workspace} className={styles.page} data-detail={!!id} data-view={gantt ? "gantt" : graph ? "graph" : "list"} data-focus={focused || undefined}>
    <WorkHead action={action} project={query.data?.pages[0]?.project.name} />
    {project && !id && <IncomingWorkspaceRequests target={project} />}
    <Toolbar className={styles.toolbar}>
      <WorkView/>
      <WorkFilters q={q} state={state} onChange={update} allProjects={!project} gantt={gantt}/>
      {graph && <div className={styles.graphActions} data-work-graph-actions/>}
    </Toolbar>
    <div className={styles.panes}>
      <div className={styles.mainPane}>
        <MainPane model={model} phone={phone} />
      </div>
      <InspectorPane model={model} />
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

function detailSearch(search: string, project: string) {
  const params = new URLSearchParams(withoutRevision(search));
  if (params.has("taskProject")) {
    params.set("scope", `project:${project}`);
    params.delete("taskProject");
  }
  return params.size ? `?${params}` : "";
}

function TaskDetail({ project, id, search, focused, pollMs, onFocus }: { project: string; id: string; search: string; focused: boolean; pollMs?: number; onFocus(on: boolean): void }) {
  const query = useGraphDetail(project, "task", id, undefined, pollMs);
  // A missing or pending task keeps the "All tasks" exit; aria-busy keeps focus off its placeholder heading (WK-E).
  if (!query.data) return <TaskInspectorUnavailable className={inspectorStyles.detail} search={withoutRevision(search)} busy={!query.isError}
    status={<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this record" onRetry={() => void query.refetch()}/>}/>;
  const notice = query.isError ? <p role="status">Latest record unavailable. Showing previously read revision. <ActionButton onClick={() => void query.refetch()}>Refresh record</ActionButton></p> : undefined;
  return <HumanTaskInspector className={inspectorStyles.detail} record={query.data} search={detailSearch(search, project)} notice={notice} focused={focused} onFocus={onFocus}/>;
}
