import { ContractError, isRecord } from "./contract";
import { validGraphId } from "./humanGraph";
export type OverviewTask = { id: string; title: string; version: string; content_revision: string; task_state: string | null; updated_at: string };
export type OverviewTaskProject = {
  project: { id: string; name: string; revision: string; workspace_id: string };
  observed_at: string | null; source_status: "available" | "unavailable";
  coverage: "complete" | "partial" | "unavailable";
  count_accuracy: "complete_observation" | "lower_bound" | "unknown";
  task_counts: { draft: number; active: number; completed: number; canceled: number } | null;
  tasks: OverviewTask[]; more_tasks: boolean | null; reason: string | null;
};
export type OverviewTasks = { contract: "human-overview-tasks-1"; observed_at: string; scope: { project_id: string | null }; projects: OverviewTaskProject[]; next_after: string | null; coverage: "complete" | "partial" };
function check(v: unknown): asserts v { if (!v) throw new ContractError("Invalid Overview task contribution"); }
function time(v: unknown): v is string { return typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)); }
function text(v: unknown, max: number): v is string { return typeof v === "string" && v.length <= max; }
function revision(v: unknown): v is string { return typeof v === "string" && /^[1-9][0-9]{0,19}$/.test(v); }
export function adaptOverviewTasks(raw: unknown, project?: string): OverviewTasks {
 check(isRecord(raw) && raw.contract === "human-overview-tasks-1" && time(raw.observed_at) && isRecord(raw.scope) && raw.scope.project_id === (project ?? null));
 check(Array.isArray(raw.projects) && raw.projects.length <= 8 && (raw.next_after === null || validGraphId(raw.next_after)) && ["complete","partial"].includes(String(raw.coverage)));
 const projectIds = new Set<string>();
 for (const row of raw.projects) {
  check(isRecord(row) && isRecord(row.project) && validGraphId(row.project.id) && validGraphId(row.project.workspace_id) && revision(row.project.revision) && text(row.project.name,128) && row.project.name.trim().length > 0);
  check(!projectIds.has(row.project.id) && (!project || row.project.id === project)); projectIds.add(row.project.id);
  check(["available","unavailable"].includes(String(row.source_status)) && ["complete","partial","unavailable"].includes(String(row.coverage)) && ["complete_observation","lower_bound","unknown"].includes(String(row.count_accuracy)));
  check((row.observed_at === null || time(row.observed_at)) && (row.reason === null || text(row.reason,512)) && (row.more_tasks === null || typeof row.more_tasks === "boolean"));
  check(Array.isArray(row.tasks) && row.tasks.length <= 32);
  const taskIds = new Set<string>();
  for (const task of row.tasks) {
   check(isRecord(task) && validGraphId(task.id) && text(task.title,512) && task.title.trim().length > 0 && revision(task.version) && revision(task.content_revision) && (task.task_state === null || text(task.task_state,64)) && time(task.updated_at));
   check(!taskIds.has(task.id)); taskIds.add(task.id);
  }
  if (row.source_status === "unavailable") check(row.coverage === "unavailable" && row.count_accuracy === "unknown" && row.task_counts === null && row.observed_at === null && row.tasks.length === 0 && row.more_tasks === null);
  else {
   check(row.observed_at !== null && row.coverage !== "unavailable" && isRecord(row.task_counts));
   for (const key of ["draft","active","completed","canceled"]) check(Number.isSafeInteger(row.task_counts[key]) && (row.task_counts[key] as number) >= 0 && (row.task_counts[key] as number) <= 32);
   check(row.count_accuracy !== "unknown" && row.more_tasks !== null);
   check(row.count_accuracy !== "complete_observation" || (row.coverage === "complete" && row.more_tasks === false));
   check(row.more_tasks !== true || (row.count_accuracy === "lower_bound" && row.coverage === "partial"));
  }
 }
 check(raw.coverage !== "complete" || (raw.next_after === null && raw.projects.every(row=>isRecord(row) && row.coverage === "complete")));
 return raw as unknown as OverviewTasks;
}
