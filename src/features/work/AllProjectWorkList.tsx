import type { ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PANEL_READ, useSession } from "../../app/session";
import { adaptWorkTaskList, WORK_PAGE_SIZE, type WorkProject, type WorkTask } from "../../api/adapters/workTaskList";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { listStatus, TASK_STATUS_LABEL, workStateFilter } from "./labels";
import { StatusIcon } from "./StatusIcon";
import { WorkFilters } from "./WorkFilters";
import styles from "./WorkWorkspace.module.css";

type Stream = { state?: string; cursor?: string };

export function AllProjectWorkList({ views }: { views?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 256).trim();
  const state = workStateFilter(params.get("state"));
  const { queryContext } = useSession();
  const client = useQueryClient();
  const key = queryKey(queryContext, "all-project-work", { q, state });
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: (state === "open" ? [{ state: "active" }, { state: "draft" }] : [{ state: state === "all" ? undefined : state }]) as Stream[],
    queryFn: ({ pageParam, signal }) => Promise.all(pageParam.map(async stream => {
      const search = new URLSearchParams({ limit: String(WORK_PAGE_SIZE) });
      if (q) search.set("q", q);
      if (stream.state) search.set("state", stream.state);
      if (stream.cursor) search.set("cursor", stream.cursor);
      const page = adaptWorkTaskList(await apiGet<unknown>(`/api/human/work/tasks?${search}`, signal), stream.state);
      return { ...page, state: stream.state };
    })),
    getNextPageParam: (last, _pages, _param, previous) => {
      const next = last.flatMap(page => page.next_cursor && !previous.some(streams =>
        streams.some(s => s.state === page.state && s.cursor === page.next_cursor))
        ? [{ state: page.state, cursor: page.next_cursor }] : []);
      return next.length ? next : undefined;
    },
    meta: PANEL_READ,
    refetchOnWindowFocus: false,
    refetchOnMount: query => query.state.isInvalidated,
  });

  const refresh = () => void client.resetQueries({ queryKey: key, exact: true });
  const update = (key: "q" | "state", value: string) => setParams(old => {
    const next = new URLSearchParams(old);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  });
  const rows = new Map<string, { task: WorkTask; projects: WorkProject[] }>();
  for (const page of query.data?.pages.flat() ?? []) {
    const projects = new Map<string, typeof page.projects>();
    for (const project of page.projects) {
      const group = projects.get(project.workspace_id) ?? [];
      group.push(project);
      projects.set(project.workspace_id, group);
    }
    for (const task of page.items) {
      const group = projects.get(task.workspace_id);
      if (group && !rows.has(task.id)) rows.set(task.id, { task, projects: group });
    }
  }
  const unavailable = Math.max(0, ...(query.data?.pages[0] ?? []).map(p => p.unavailable_projects));
  const visible = [...rows.values()];
  if (state === "open") visible.sort((a, b) =>
    Date.parse(b.task.updated_at) - Date.parse(a.task.updated_at) || b.task.id.localeCompare(a.task.id));
  const title = query.isError || !query.data ? "Tasks" : `${rows.size} ${rows.size === 1 ? "task" : "tasks"} loaded`;

  return <>
    <Toolbar className={styles.toolbar}>
      {views}
      <WorkFilters q={q} state={state} onChange={update} allProjects/>
    </Toolbar>
    <div className={styles.mainPane}>
      <Panel title={title} actions={<ActionButton disabled={query.isFetching} onClick={refresh}>Refresh list</ActionButton>}>
        {query.isError || !query.data ? <QueryStatus status={query.isError ? "error" : "pending"}
          error={query.error} label="tasks" onRetry={refresh}/> : <>
          {unavailable > 0 && <p role="status" className={styles.meta}>
            Task records are unavailable for {unavailable} {unavailable === 1 ? "project" : "projects"}.
          </p>}
          {rows.size === 0 ? <p>{unavailable ? "No matching tasks in available projects." : "No matching tasks across projects."}</p> :
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
            </ul>}
          {query.hasNextPage && <ActionButton className={styles.moreTasks} disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}</ActionButton>}
        </>}
      </Panel>
    </div>
  </>;
}
