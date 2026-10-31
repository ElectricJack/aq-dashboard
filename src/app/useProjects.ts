import type { Page, ProjectRef } from "../api/wire/proposed";
import { adaptPage } from "../api/adapters/inspection";
import { ContractError } from "../api/adapters/contract";
import { useRead } from "./useRead";
import { useSession } from "./session";

/** Bounded first page for the picker; a URL can still select another authorized project. */
export function useProjects() {
  const { bootstrap } = useSession();
  return useRead<Page<ProjectRef>, ProjectRef[]>({
    resource: "projects",
    path: "/api/v1/projects",
    params: { limit: 100 },
    enabled: bootstrap.capability("projects.read").enabled,
    adapt: (page) => adaptPage(page, (project) => {
      if (typeof project.id !== "string" || typeof project.label !== "string") {
        throw new ContractError("Invalid project identity");
      }
      return project;
    }).items,
  });
}
