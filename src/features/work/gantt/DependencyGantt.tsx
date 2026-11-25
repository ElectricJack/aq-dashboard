import type { ReactNode } from "react";
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

export function DependencyGantt({ project, selected, compact = false, search = "", focused = false, runningProjects = [], showOffline = true }: {
  project?: string; selected?: string; compact?: boolean; search?: string; focused?: boolean; runningProjects?: string[]; showOffline?: boolean;
}) {
  if (project) return <ProjectTracks projects={[{ id: project, label: project }]} {...{ selected, compact, search, focused, showOffline }} />;
  return <AllProjectTracks {...{ compact, selected, search, focused, runningProjects, showOffline }} />;
}

function prioritizeProjects(valid: GanttProject[], runningProjects: string[]) {
  const running = new Set(runningProjects);
  return valid.length > GANTT_PROJECT_LIMIT
    ? [...valid.filter(project => running.has(project.id)), ...valid.filter(project => !running.has(project.id))].slice(0, GANTT_PROJECT_LIMIT)
    : valid;
}

function AllProjectTracks({ compact, selected, search, focused, runningProjects, showOffline }: {
  compact: boolean; selected?: string; search: string; focused: boolean; runningProjects: string[]; showOffline: boolean;
}) {
  const capability = useProjectsCapability();
  const projects = useProjects();
  if (!capability.enabled) return <p className={styles.message}>Choose a project to view its dependency tracks.</p>;
  if (!projects.data) return <QueryStatus status={projects.isError ? "error" : "pending"} error={projects.error}
    label="projects" onRetry={() => void projects.refetch()} />;
  const valid = [...new Map(projects.data.view.filter(project => validGraphId(project.id)).map(project => [project.id, project])).values()];
  if (!valid.length) return <p className={styles.message}>{projects.data.view.length ? "Dependency tracks are unavailable for these projects." : "No projects are available."}</p>;
  const selectedProjects = prioritizeProjects(valid, runningProjects);
  return <>
    <RetainedNotice query={projects} showOffline={false} />
    {valid.length > GANTT_PROJECT_LIMIT && <p className={styles.message}>Showing {GANTT_PROJECT_LIMIT} projects. Choose a project from the scope menu to see its tracks.</p>}
    <ProjectTracks projects={selectedProjects} grouped {...{ compact, selected, search, focused, showOffline }} />
  </>;
}

type ProjectQueries = ReturnType<typeof useGanttProjects>;

function trackStatus(queries: ProjectQueries, projects: GanttProject[]) {
  const available = queries.flatMap(query => query.data ?? []);
  const pending = queries.some(query => query.isPending);
  const error = queries.find(query => query.isError);
  const refresh = () => queries.forEach(query => void query.refetch());
  const missing = projects.filter((_, index) => queries[index]!.isError && !queries[index]!.data);
  const partial = available.filter(snapshot => snapshot.partial);
  const loaded = queries.filter(query => query.data);
  const retained = loaded.find(query => query.isError) ?? loaded[0];
  return { available, pending, error, refresh, missing, partial, retained, incomplete: Boolean(error || partial.length), fetching: queries.some(query => query.isFetching) };
}

type TrackStatus = ReturnType<typeof trackStatus>;

function TrackMessage({ show, children }: { show: boolean; children: ReactNode }) {
  return show ? <p className={styles.message} role="status">{children}</p> : null;
}

function TrackNotices({ status, grouped, showOffline }: { status: TrackStatus; grouped: boolean; showOffline: boolean }) {
  const { retained, pending, missing, partial, incomplete, refresh, fetching } = status;
  return <>
    {retained && <RetainedNotice query={retained} showOffline={showOffline} />}
    <TrackMessage show={pending}>Loading more dependency tracks…</TrackMessage>
    <TrackMessage show={missing.length > 0}>Tracks unavailable for {missing.map(m => m.label).join(", ")}.</TrackMessage>
    <TrackMessage show={partial.length > 0}>{grouped ? `Partial dependency coverage for ${partial.map(s => s.project.label).join(", ")}.` : "Some tasks or dependencies are unavailable in this view."}</TrackMessage>
    {incomplete && <ActionButton disabled={fetching} onClick={refresh}>Refresh tracks</ActionButton>}
  </>;
}

function emptyTracks(status: TrackStatus, filter: string) {
  if (filter) return "No matching tasks in these tracks.";
  if (status.incomplete) return "No unfinished tasks in the available tracks.";
  return "No unfinished tasks.";
}

type TracksProps = {
  projects: GanttProject[]; grouped?: boolean; selected?: string; compact: boolean; search: string; focused: boolean; showOffline: boolean;
};

function ProjectTracks(props: TracksProps) {
  const { projects } = props;
  const status = trackStatus(useGanttProjects(projects), projects);
  const { available, pending, error, refresh } = status;
  if (!available.length) return <QueryStatus status={pending ? "pending" : "error"} error={error?.error}
    label="dependency tracks" onRetry={refresh} />;

  return <AvailableTracks {...props} status={status} />;
}

function fullViewLink(props: TracksProps) {
  if (!props.compact) return undefined;
  const project = props.grouped ? undefined : props.projects[0]?.id;
  return <Link className={styles.openGantt} to={{ pathname: "/work", search: projectGanttSearch(project) }}>Open Gantt →</Link>;
}

function AvailableTracks(props: TracksProps & { status: TrackStatus }) {
  const { grouped = false, selected, compact, search, focused, showOffline, status } = props;
  const { available, pending } = status;
  const fullView = fullViewLink(props);
  const filter = (new URLSearchParams(search).get("q") ?? "").trim().slice(0, 256).toLowerCase();
  const layout = layoutGantt(available, grouped, filter);
  return <>
    <TrackNotices status={status} grouped={grouped} showOffline={showOffline} />
    {layout.unresolved && <p className={styles.message}>Some tasks form or depend on a dependency loop.</p>}
    {layout.tasks.length > 0 ? <GanttCanvas layout={layout} compact={compact} fullView={fullView} selected={focused ? undefined : selected} linkTo={task => ganttTaskTarget(task.project, task.id, search, grouped && !compact)} />
      : !pending && <p className={styles.message}>{emptyTracks(status, filter)}</p>}
    {layout.tasks.length === 0 && fullView}
  </>;
}

function projectGanttSearch(project?: string) {
  const params = new URLSearchParams({ view: "gantt" });
  if (project) params.set("scope", `project:${project}`);
  return `?${params}`;
}
