import { ContractError, isRecord } from "./contract";
import { validGraphId } from "./humanGraph";

export const WORK_PAGE_SIZE = 50;

export type WorkProject = { id: string; workspace_id: string; name: string };
export type WorkTask = { id: string; workspace_id: string; title: string; task_state: string; updated_at: string };
type WorkPage = { items: WorkTask[]; projects: WorkProject[]; unavailable_projects: number; next_cursor: string | null };

function check(ok: unknown): asserts ok {
  if (!ok) throw new ContractError("Invalid all-project Work page");
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit && value.trim().length > 0;
}

function projectWorkspaces(rows: unknown[]): Set<string> {
  const projects = new Set<string>();
  const workspaces = new Set<string>();
  for (const project of rows) {
    check(isRecord(project) && validGraphId(project.id) && !projects.has(project.id) && validGraphId(project.workspace_id));
    check(validText(project.name, 128));
    projects.add(project.id);
    workspaces.add(project.workspace_id);
  }
  return workspaces;
}

function validateTasks(rows: unknown[], workspaces: Set<string>, state?: string): void {
  const seen = new Set<string>();
  const usedWorkspaces = new Set<string>();
  for (const task of rows) {
    check(isRecord(task) && validGraphId(task.id) && !seen.has(task.id));
    check(validGraphId(task.workspace_id) && workspaces.has(task.workspace_id));
    check(validText(task.title, 512));
    check(typeof task.task_state === "string" && ["draft", "active", "completed", "canceled"].includes(task.task_state));
    check(!state || task.task_state === state);
    check(typeof task.updated_at === "string" && Number.isFinite(Date.parse(task.updated_at)));
    seen.add(task.id);
    usedWorkspaces.add(task.workspace_id);
  }
  check(usedWorkspaces.size === workspaces.size);
}

function validCursor(cursor: unknown, itemCount: number): cursor is string | null {
  if (cursor === null) return true;
  return typeof cursor === "string" && /^[\w-]{1,4096}$/.test(cursor) && itemCount === WORK_PAGE_SIZE;
}

export function adaptWorkTaskList(raw: unknown, state?: string): WorkPage {
  check(isRecord(raw) && raw.contract === "human-work-task-list-1");
  check(Array.isArray(raw.items) && raw.items.length <= WORK_PAGE_SIZE);
  check(Array.isArray(raw.projects) && raw.projects.length <= 4096);
  check(typeof raw.unavailable_projects === "number" && Number.isInteger(raw.unavailable_projects) &&
    raw.unavailable_projects >= 0 && raw.unavailable_projects + raw.projects.length <= 4096);
  check(validCursor(raw.next_cursor, raw.items.length));
  validateTasks(raw.items, projectWorkspaces(raw.projects), state);
  return { items: raw.items, projects: raw.projects, unavailable_projects: raw.unavailable_projects, next_cursor: raw.next_cursor };
}
