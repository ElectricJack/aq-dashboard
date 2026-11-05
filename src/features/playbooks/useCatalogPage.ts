import { useQuery } from "@tanstack/react-query";
import { adaptCatalog, CATALOG_CAPABILITY, type CatalogKind } from "../../api/adapters/playbookCatalog";
import { playbookCatalogJson } from "../../api/playbookCatalogClient";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";

/** First bounded catalog page for an action form's choices; read only while the action is offered. */
export function useCatalogPage(kind: CatalogKind, offered: boolean) {
  const { bootstrap, queryContext } = useSession(); const [scope] = useScope();
  const project = scope.kind === "project" ? scope.project_id : null, readable = bootstrap.capability(CATALOG_CAPABILITY).enabled;
  const query = useQuery({ queryKey: scopedKey(queryContext, scope, "playbook-action-catalog", { kind }), enabled: offered && readable, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptCatalog(await playbookCatalogJson(kind, project, {}, signal), kind, project, {}) });
  const unavailable = !readable ? `Current playbook ${kind} are not readable` : query.isError ? `Current playbook ${kind} could not be loaded` : !query.data ? `Loading current playbook ${kind}` : undefined;
  return { page: query.data, unavailable, refetch: query.refetch };
}
