import type { Page, ProjectRef } from "../api/wire/proposed";
import { adaptPage } from "../api/adapters/inspection";
import { ContractError } from "../api/adapters/contract";
import { useRead } from "./useRead";
import { useSession } from "./session";

/**
 * Whether this AQ server offers the project list. A disabled read never
 * resolves, so callers must present `enabled: false` with its reason rather
 * than as loading (docs/specs/0002 §10).
 */
export function useProjectsCapability() {
  return useSession().bootstrap.capability("projects.read");
}

/** Bounded first page for the picker; a URL can still select another authorized project. */
export function useProjects() {
  const capability = useProjectsCapability();
  return useRead<Page<ProjectRef>, ProjectRef[]>({
    resource: "projects",
    path: "/api/v1/projects",
    params: { limit: 100 },
    enabled: capability.enabled,
    adapt: (page) => adaptPage(page, (project) => {
      if (typeof project.id !== "string" || typeof project.label !== "string") {
        throw new ContractError("Invalid project identity");
      }
      return project;
    }).items,
  });
}
