import { ContractError, isRecord } from "./contract";
import { validGraphId } from "./humanGraph";

export const WORK_PAGE_SIZE = 50;

export type WorkProject = { id: string; workspace_id: string; name: string };
export type WorkTask = { id: string; workspace_id: string; title: string; task_state: string; updated_at: string };
type WorkPage = { items: WorkTask[]; projects: WorkProject[]; unavailable_projects: number; next_cursor: string | null };

function check(ok: unknown): asserts ok {
  if (!ok) throw new ContractError("Invalid all-project Work page");
}

export function adaptWorkTaskList(raw: unknown, state?: string): WorkPage {
  check(isRecord(raw) && raw.contract === "human-work-task-list-1");
  check(Array.isArray(raw.items) && raw.items.length <= WORK_PAGE_SIZE);
  check(Array.isArray(raw.projects) && raw.projects.length <= 4096);
  check(typeof raw.unavailable_projects === "number" && Number.isInteger(raw.unavailable_projects) &&
    raw.unavailable_projects >= 0 && raw.unavailable_projects + raw.projects.length <= 4096);
  check(raw.next_cursor === null || (typeof raw.next_cursor === "string" && /^[\w-]{1,4096}$/.test(raw.next_cursor) &&
    raw.items.length === WORK_PAGE_SIZE));
  const projects = new Set<string>();
  const workspaces = new Set<string>();
  for (const project of raw.projects) {
    check(isRecord(project) && validGraphId(project.id) && !projects.has(project.id) && validGraphId(project.workspace_id));
    check(typeof project.name === "string" && project.name.trim().length > 0 && project.name.length <= 128);
    projects.add(project.id);
    workspaces.add(project.workspace_id);
  }
  const seen = new Set<string>();
  const usedWorkspaces = new Set<string>();
  for (const task of raw.items) {
    check(isRecord(task) && validGraphId(task.id) && !seen.has(task.id));
    check(validGraphId(task.workspace_id) && workspaces.has(task.workspace_id));
    check(typeof task.title === "string" && task.title.trim().length > 0 && task.title.length <= 512);
    check(typeof task.task_state === "string" && ["draft", "active", "completed", "canceled"].includes(task.task_state));
    check(!state || task.task_state === state);
    check(typeof task.updated_at === "string" && Number.isFinite(Date.parse(task.updated_at)));
    seen.add(task.id);
    usedWorkspaces.add(task.workspace_id);
  }
  check(usedWorkspaces.size === workspaces.size);
  return { items: raw.items, projects: raw.projects, unavailable_projects: raw.unavailable_projects, next_cursor: raw.next_cursor };
}
