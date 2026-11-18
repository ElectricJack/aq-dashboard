import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PANEL_READ, useSession } from "../../app/session";
import { scopeSearch } from "../../app/scope";
import { adaptWorkTaskList, WORK_PAGE_SIZE, type WorkProject, type WorkTask } from "../../api/adapters/workTaskList";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import { listStatus, TASK_STATUS_LABEL, workStateFilter } from "./labels";
import { StatusIcon } from "./StatusIcon";
import { WorkFilters } from "./WorkFilters";
import styles from "./WorkWorkspace.module.css";

export function AllProjectWorkList() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 256).trim();
  const state = workStateFilter(params.get("state"));
  const { queryContext } = useSession();
  const client = useQueryClient();
  const key = queryKey(queryContext, "all-project-work", { q, state });
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const search = new URLSearchParams({ limit: String(WORK_PAGE_SIZE) });
      if (q) search.set("q", q);
      if (state) search.set("state", state);
      if (pageParam) search.set("cursor", pageParam);
      return adaptWorkTaskList(await apiGet<unknown>(`/api/human/work/tasks?${search}`, signal), state);
    },
    getNextPageParam: (last, _pages, _lastParam, previous) =>
      last.next_cursor && !previous.includes(last.next_cursor) ? last.next_cursor : undefined,
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
  for (const page of query.data?.pages ?? []) {
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
  const unavailable = query.data?.pages[0]?.unavailable_projects ?? 0;
  const title = query.isError || !query.data ? "Tasks" : `${rows.size} ${rows.size === 1 ? "task" : "tasks"} loaded`;

  return <>
    <Toolbar className={styles.toolbar}>
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
              {[...rows.values()].flatMap(({ task, projects }) => {
                const status = listStatus(task, undefined);
                return projects.map(project => <li key={`${task.id}:${project.id}`}>
                  <Link className={styles.row} aria-label={`${task.title}, ${project.name}, ${TASK_STATUS_LABEL[status]}`}
                    to={{ pathname: `/work/${task.id}`, search: scopeSearch({ kind: "project", project_id: project.id }) }}>
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
