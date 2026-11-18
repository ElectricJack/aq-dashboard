import { Link } from "react-router";
import { validGraphId } from "../../../api/adapters/humanGraph";
import { useProjects, useProjectsCapability } from "../../../app/useProjects";
import { ActionButton } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { GanttCanvas } from "./GanttCanvas";
import { GANTT_PROJECT_LIMIT, useGanttProjects, type GanttProject } from "./ganttData";
import { layoutGantt } from "./ganttLayout";
import styles from "./Gantt.module.css";

export function ganttTaskTarget(project: string, id: string, search = "", keepAllProjects = false) {
  const params = new URLSearchParams(search);
  if (keepAllProjects) params.set("taskProject", project);
  else {
    params.set("scope", `project:${project}`);
    params.delete("taskProject");
  }
  params.set("view", "gantt");
  for (const key of ["root", "focus", "revision"]) params.delete(key);
  return { pathname: `/work/${encodeURIComponent(id)}`, search: `?${params}` };
}

export function DependencyGantt({ project, selected, compact = false, search = "", focused = false, runningProjects = [] }: {
  project?: string; selected?: string; compact?: boolean; search?: string; focused?: boolean; runningProjects?: string[];
}) {
  if (project) return <ProjectTracks projects={[{ id: project, label: project }]} {...{ selected, compact, search, focused }} />;
  return <AllProjectTracks {...{ compact, selected, search, focused, runningProjects }} />;
}

function AllProjectTracks({ compact, selected, search, focused, runningProjects }: {
  compact: boolean; selected?: string; search: string; focused: boolean; runningProjects: string[];
}) {
  const capability = useProjectsCapability();
  const projects = useProjects();
  if (!capability.enabled) return <p className={styles.message}>Choose a project to view its dependency tracks.</p>;
  if (!projects.data) return <QueryStatus status={projects.isError ? "error" : "pending"} error={projects.error}
    label="projects" onRetry={() => void projects.refetch()} />;
  const valid = [...new Map(projects.data.view.filter(project => validGraphId(project.id)).map(project => [project.id, project])).values()];
  if (!valid.length) return <p className={styles.message}>{projects.data.view.length ? "Dependency tracks are unavailable for these projects." : "No projects are available."}</p>;
  const running = new Set(runningProjects);
  const selectedProjects = valid.length > GANTT_PROJECT_LIMIT
    ? [...valid.filter(project => running.has(project.id)), ...valid.filter(project => !running.has(project.id))].slice(0, GANTT_PROJECT_LIMIT)
    : valid;
  return <>
    <RetainedNotice query={projects} />
    {valid.length > GANTT_PROJECT_LIMIT && <p className={styles.message}>Showing {GANTT_PROJECT_LIMIT} projects. Choose a project from the scope menu to see its tracks.</p>}
    <ProjectTracks projects={selectedProjects} grouped {...{ compact, selected, search, focused }} />
  </>;
}

function ProjectTracks({ projects, grouped = false, selected, compact, search, focused }: {
  projects: GanttProject[]; grouped?: boolean; selected?: string; compact: boolean; search: string; focused: boolean;
}) {
  const queries = useGanttProjects(projects);
  const available = queries.flatMap(query => query.data ? [query.data] : []);
  const pending = queries.some(query => query.isPending);
  const error = queries.find(query => query.isError);
  const refresh = () => queries.forEach(query => void query.refetch());
  if (!available.length) return <QueryStatus status={pending ? "pending" : "error"} error={error?.error}
    label="dependency tracks" onRetry={refresh} />;

  const fullView = compact ? <Link className={styles.openGantt} to={{ pathname: "/work", search: projectGanttSearch(grouped ? undefined : projects[0]?.id) }}>Open Gantt →</Link> : undefined;
  const filter = (new URLSearchParams(search).get("q") ?? "").trim().slice(0, 256).toLowerCase();
  const layout = layoutGantt(available, grouped, filter);
  const missing = projects.filter((_, index) => queries[index]!.isError && !queries[index]!.data);
  const partial = available.filter(snapshot => snapshot.partial);
  const retained = queries.find(query => query.isError && query.data) ?? queries.find(query => query.data);
  return <>
    {retained && <RetainedNotice query={retained} />}
    {pending && <p className={styles.message} role="status">Loading more dependency tracks…</p>}
    {missing.length > 0 && <p className={styles.message} role="status">Tracks unavailable for {missing.map(m => m.label).join(", ")}.</p>}
    {partial.length > 0 && <p className={styles.message} role="status">{grouped ? `Partial dependency coverage for ${partial.map(s => s.project.label).join(", ")}.` : "Some tasks or dependencies are unavailable in this view."}</p>}
    {(error || partial.length > 0) && <ActionButton disabled={queries.some(query => query.isFetching)} onClick={refresh}>Refresh tracks</ActionButton>}
    {layout.unresolved && <p className={styles.message}>Some tasks form or depend on a dependency loop.</p>}
    {layout.tasks.length > 0 ? <GanttCanvas layout={layout} compact={compact} fullView={fullView} selected={focused ? undefined : selected} linkTo={task => ganttTaskTarget(task.project, task.id, search, grouped && !compact)} />
      : !pending && <p className={styles.message}>{filter ? "No matching tasks in these tracks." : missing.length || partial.length || error ? "No unfinished tasks in the available tracks." : "No unfinished tasks."}</p>}
    {layout.tasks.length === 0 && fullView}
  </>;
}

function projectGanttSearch(project?: string) {
  const params = new URLSearchParams({ view: "gantt" });
  if (project) params.set("scope", `project:${project}`);
  return `?${params}`;
}
