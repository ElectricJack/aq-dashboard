import type { ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PANEL_READ, useSession } from "../../app/session";
import { adaptWorkTaskList, WORK_PAGE_SIZE, type WorkProject, type WorkTask } from "../../api/adapters/workTaskList";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { listStatus, TASK_STATUS_LABEL, workStateFilter, type WorkStateFilter } from "./labels";
import { StatusIcon } from "./StatusIcon";
import { WorkFilters } from "./WorkFilters";
import styles from "./WorkWorkspace.module.css";

type Stream = { state?: string; cursor?: string };

type StreamPage = ReturnType<typeof adaptWorkTaskList> & { state?: string };
type TaskRow = { task: WorkTask; projects: WorkProject[] };

function initialStreams(state: WorkStateFilter): Stream[] {
  if (state === "open") return [{ state: "active" }, { state: "draft" }];
  return [{ state: state === "all" ? undefined : state }];
}

async function readStream(stream: Stream, q: string, signal: AbortSignal): Promise<StreamPage> {
  const search = new URLSearchParams({ limit: String(WORK_PAGE_SIZE) });
  if (q) search.set("q", q);
  if (stream.state) search.set("state", stream.state);
  if (stream.cursor) search.set("cursor", stream.cursor);
  const page = adaptWorkTaskList(await apiGet<unknown>(`/api/human/work/tasks?${search}`, signal), stream.state);
  return { ...page, state: stream.state };
}

function nextStreams(pages: StreamPage[], previous: Stream[][]) {
  const next: Stream[] = [];
  const seen = previous.flat();
  for (const { state, next_cursor } of pages) {
    if (!next_cursor) continue;
    if (seen.some(stream => stream.state === state && stream.cursor === next_cursor)) continue;
    next.push({ state, cursor: next_cursor });
  }
  return next.length ? next : undefined;
}

function useProjectList(q: string, state: WorkStateFilter) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const key = queryKey(queryContext, "all-project-work", { q, state });
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: initialStreams(state),
    queryFn: ({ pageParam, signal }) => Promise.all(pageParam.map(stream => readStream(stream, q, signal))),
    getNextPageParam: (last, _pages, _param, previous) => nextStreams(last, previous),
    meta: PANEL_READ,
    refetchOnWindowFocus: false,
    refetchOnMount: query => query.state.isInvalidated,
  });

  const refresh = () => void client.resetQueries({ queryKey: key, exact: true });
  return { query, refresh };
}

function workspaceProjects(projects: WorkProject[]) {
  const groups = new Map<string, WorkProject[]>();
  for (const project of projects) {
    const group = groups.get(project.workspace_id) ?? [];
    group.push(project);
    groups.set(project.workspace_id, group);
  }
  return groups;
}

function visibleTasks(pages: StreamPage[][], state: WorkStateFilter) {
  const rows = new Map<string, TaskRow>();
  for (const page of pages.flat()) {
    const projects = workspaceProjects(page.projects);
    for (const task of page.items) {
      const group = projects.get(task.workspace_id);
      if (group && !rows.has(task.id)) rows.set(task.id, { task, projects: group });
    }
  }
  const visible = [...rows.values()];
  if (state === "open") visible.sort((a, b) =>
    Date.parse(b.task.updated_at) - Date.parse(a.task.updated_at) || b.task.id.localeCompare(a.task.id));
  return visible;
}

function TaskRows({ visible, params }: { visible: TaskRow[]; params: URLSearchParams }) {
  return (
    <ul className={styles.rows} aria-label="Tasks">
      {visible.flatMap(({ task, projects }) => {
        const status = listStatus(task, undefined);
        return projects.map(project => <li key={`${task.id}:${project.id}`}>
          <Link className={styles.row} aria-label={`${task.title}, ${project.name}, ${TASK_STATUS_LABEL[status]}`}
            to={{ pathname: `/work/${task.id}`, search: new URLSearchParams({ ...Object.fromEntries(params), scope: `project:${project.id}` }).toString() }}>
            <StatusIcon status={status}/>
            <span className={styles.rowTitle} title={task.title}>{task.title}</span>
            <span className={styles.rowProject} title={project.name}>{project.name}</span>
          </Link>
        </li>);
      })}
    </ul>
  );
}

function ListContents({ visible, unavailable, params }: { visible: TaskRow[]; unavailable: number; params: URLSearchParams }) {
  return <>
    {unavailable > 0 && <p role="status" className={styles.meta}>
      Task records are unavailable for {unavailable} {unavailable === 1 ? "project" : "projects"}.
    </p>}
    {visible.length === 0 ? <p>{unavailable ? "No matching tasks in available projects." : "No matching tasks across projects."}</p> :
      <TaskRows visible={visible} params={params} />}
  </>;
}

function listTitle(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"} loaded`;
}

export function AllProjectWorkList({ views }: { views?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 256).trim();
  const state = workStateFilter(params.get("state"));
  const { query, refresh } = useProjectList(q, state);
  const update = (key: "q" | "state", value: string) => setParams(old => {
    const next = new URLSearchParams(old);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  });
  const pages = query.data?.pages ?? [];
  const visible = visibleTasks(pages, state);
  const unavailable = Math.max(0, ...(pages[0] ?? []).map(p => p.unavailable_projects));
  const ready = !!query.data && !query.isError;
  const title = ready ? listTitle(visible.length) : "Tasks";

  return <>
    <Toolbar className={styles.toolbar}>
      {views}
      <WorkFilters q={q} state={state} onChange={update} allProjects/>
    </Toolbar>
    <div className={styles.mainPane}>
      <Panel title={title} actions={<ActionButton disabled={query.isFetching} onClick={refresh}>Refresh list</ActionButton>}>
        {!ready ? <QueryStatus status={query.isError ? "error" : "pending"}
          error={query.error} label="tasks" onRetry={refresh}/> : <>
          <ListContents visible={visible} unavailable={unavailable} params={params} />
          {query.hasNextPage && <ActionButton className={styles.moreTasks} disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}</ActionButton>}
        </>}
      </Panel>
    </div>
  </>;
}
