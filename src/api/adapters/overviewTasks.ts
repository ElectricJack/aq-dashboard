import { ContractError, isRecord, nullable } from "./contract";
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
function checkTasks(tasks: unknown[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    check(isRecord(task));
    check(validGraphId(task.id));
    check(!ids.has(task.id));
    check(text(task.title, 512) && task.title.trim().length > 0);
    check(revision(task.version));
    check(revision(task.content_revision));
    check(nullable(task.task_state, value => text(value, 64)));
    check(time(task.updated_at));
    ids.add(task.id);
  }
}

function validTaskCount(count: unknown): boolean {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 32;
}

function validateCounts(row: Record<string, unknown>, size: number) {
  if (row.source_status === "unavailable") {
    check(row.coverage === "unavailable");
    check(row.count_accuracy === "unknown");
    check(row.task_counts === null);
    check(row.observed_at === null);
    check(size === 0);
    check(row.more_tasks === null);
    return;
  }
  check(row.observed_at !== null);
  check(row.coverage !== "unavailable");
  check(isRecord(row.task_counts));
  for (const key of ["draft", "active", "completed", "canceled"]) {
    const count = row.task_counts[key];
    check(validTaskCount(count));
  }
  check(row.count_accuracy !== "unknown");
  check(row.more_tasks !== null);
  if (row.count_accuracy === "complete_observation") check(row.coverage === "complete" && row.more_tasks === false);
  if (row.more_tasks === true) check(row.count_accuracy === "lower_bound" && row.coverage === "partial");
}

function checkProject(row: unknown): string {
  check(isRecord(row));
  check(isRecord(row.project));
  const project = row.project;
  check(validGraphId(project.id));
  check(validGraphId(project.workspace_id));
  check(revision(project.revision));
  check(text(project.name, 128) && project.name.trim().length > 0);
  check(["available","unavailable"].includes(String(row.source_status)));
  check(["complete","partial","unavailable"].includes(String(row.coverage)));
  check(["complete_observation","lower_bound","unknown"].includes(String(row.count_accuracy)));
  check(nullable(row.observed_at, time));
  check(nullable(row.reason, value => text(value, 512)));
  check(nullable(row.more_tasks, value => typeof value === "boolean"));
  check(Array.isArray(row.tasks));
  check(row.tasks.length <= 32);
  checkTasks(row.tasks);
  validateCounts(row, row.tasks.length);
  return project.id;
}

export function adaptOverviewTasks(raw: unknown, project?: string): OverviewTasks {
  check(isRecord(raw));
  check(raw.contract === "human-overview-tasks-1");
  check(time(raw.observed_at));
  check(isRecord(raw.scope));
  check(raw.scope.project_id === (project ?? null));
  check(Array.isArray(raw.projects));
  check(raw.projects.length <= 8);
  check(nullable(raw.next_after, validGraphId));
  check(["complete","partial"].includes(String(raw.coverage)));
  const ids = new Set<string>();
  for (const row of raw.projects) {
    const id = checkProject(row);
    check(!ids.has(id));
    if (project) check(id === project);
    ids.add(id);
  }
  if (raw.coverage === "complete") {
    check(raw.next_after === null);
    check(raw.projects.every(row => isRecord(row) && row.coverage === "complete"));
  }
  return raw as unknown as OverviewTasks;
}
