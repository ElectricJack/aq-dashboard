import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { isRecord } from "../../api/adapters/contract";
import { validGraphId } from "../../api/adapters/humanGraph";
import { apiGet } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { useDocuments } from "../../api/roleSettings";
import { PANEL_READ, useSession } from "../../app/session";
import type { TaskRole } from "./taskWork";

/**
 * A task's role (aq-server spec 0014 §5.5). A task names its role, or names none and runs as its project's default
 * role; the router then assigns the level. These helpers serve the two places a person chooses a role (filing a task,
 * and "Change role" on a task) and the one place it is shown (the task's Status).
 */

/** The role of a project whose binding states none (`aq-project-policy`: a default is not written to the record). */
const BINDING_DEFAULT_ROLE = "developer";

export type RoleChoice = { id: string; name: string };
/** The roles a task may be handed, and each role's name. Both come from Settings → Roles. */
export function useTaskRoles(enabled = true) {
  const query = useDocuments("role", { enabled, panel: true });
  const documents = query.data?.documents ?? [];
  const names = new Map(documents.flatMap(document => document.fields ? [[document.id, document.fields.name] as const] : []));
  // A disabled role is handed no new work, so it is not offered; a role AQ cannot read is not a role yet.
  const choices: RoleChoice[] = documents.flatMap(document => document.fields?.enabled ? [{ id: document.id, name: document.fields.name }] : []).sort((a, b) => a.name.localeCompare(b.name));
  return { choices, name: (id: string) => names.get(id) || id, loaded: query.data !== undefined, failed: query.isError && query.data === undefined };
}

/** The project's default role, from its binding (`GET /api/projects/{id}`); `undefined` while unknown or when the read is refused. */
export function useProjectDefaultRole(project: string | undefined, enabled = true): string | undefined {
  const { queryContext } = useSession();
  const query = useQuery({
    queryKey: queryKey(queryContext, "project-default-role", { project: project ?? "" }), enabled: enabled && validGraphId(project), retry: false, refetchOnWindowFocus: false, staleTime: 60_000, meta: PANEL_READ,
    queryFn: async ({ signal }) => {
      const raw = await apiGet<unknown>(`/api/projects/${encodeURIComponent(project!)}`, signal);
      const stated = isRecord(raw) && isRecord(raw.binding) ? raw.binding.default_role : undefined;
      return typeof stated === "string" && stated.length > 0 && stated.length <= 128 ? stated : BINDING_DEFAULT_ROLE;
    },
  });
  return query.data;
}

/** "project default" or "set on this task": where the task's role comes from. */
export const roleSourceLabel = (source: TaskRole["source"]) => source === "task" ? "set on this task" : "project default";

/**
 * The Role select. Its first option leaves the choice to the project ("Developer (project default)"); `value` is then
 * `""` and nothing is sent, so the task follows the project's default even if that changes. Any other option names a role.
 * `current` keeps a role the task already names in the list when it is not one of the enabled roles. `defaultRole` is
 * the project's default when known; `status` says whether the roles are still being read or could not be read.
 */
export function RoleOptions({ choices, name, defaultRole, status = "ready", value, onChange, disabled, current, hintClassName }: {
  choices: RoleChoice[]; name(id: string): string; defaultRole?: string; status?: "ready" | "reading" | "failed";
  value: string; onChange(role: string): void; disabled?: boolean; current?: string; hintClassName?: string;
}) {
  const hint = useId();
  const extra = [value, current].filter((id, i, all): id is string => !!id && all.indexOf(id) === i && !choices.some(choice => choice.id === id));
  return <>
    <label>Role<select value={value} disabled={disabled} aria-describedby={hint} onChange={event => onChange(event.target.value)}>
      <option value="">{defaultRole ? `${name(defaultRole)} (project default)` : "Project default"}</option>
      {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      {extra.map(id => <option key={id} value={id}>{name(id)}{status === "ready" ? " (not enabled)" : ""}</option>)}
    </select></label>
    <span id={hint} className={hintClassName} data-role-hint="">{status === "failed" ? "The roles could not be read, so only the project's default is offered."
      : status === "reading" ? "Reading the roles…" : "The role is the kind of work. AQ's router chooses the level."}</span>
  </>;
}
/** {@link RoleOptions} over the roles saved in Settings and the default of `project`. */
export function RoleSelect({ project, ...props }: { project?: string; value: string; onChange(role: string): void; disabled?: boolean; current?: string; hintClassName?: string }) {
  const roles = useTaskRoles(), defaultRole = useProjectDefaultRole(project);
  return <RoleOptions {...props} choices={roles.choices} name={roles.name} defaultRole={defaultRole} status={roles.failed ? "failed" : roles.loaded ? "ready" : "reading"} />;
}
