import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { adaptProjectBindings, mergeProjectPages, PROJECT_PAGE_SIZE, validationLabel } from "../../api/adapters/projectBindings";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ProjectControl, projectState } from "./ProjectControl";
import { Timestamp } from "./Timestamp";
import styles from "./ProjectBindings.module.css";

const MAX_PAGES = 4;
export function ProjectBindings() {
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability("projects.read");
  const query = useInfiniteQuery({
    queryKey: queryKey(queryContext, "project-execution-bindings", {}),
    enabled: capability.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(PROJECT_PAGE_SIZE) });
      if (pageParam) params.set("after", pageParam);
      return adaptProjectBindings(await apiGet<unknown>(`/api/projects?${params}`, signal), pageParam);
    },
    getNextPageParam: (last, all) => all.length < MAX_PAGES ? last.next ?? undefined : undefined,
    retry: false,
  });
  const pages = query.data?.pages;
  let items: ReturnType<typeof mergeProjectPages> = [];
  let pageError: unknown;
  try { items = mergeProjectPages(pages ?? []); } catch (e) { pageError = e; }
  const loaded = capability.enabled && !!pages && !query.isError && !pageError;
  return <Panel title="Projects" description="Start permits queued work to launch. Stop prevents new launches; running agents may stop at their next policy check."
    actions={loaded && <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh projects</ActionButton>}>
    {!capability.enabled ? <p className={styles.meta}>{capability.reason}</p> : !pages || query.isError || pageError ?
      <QueryStatus status={query.isError || pageError ? "error" : "pending"} error={query.error ?? pageError} label="project execution bindings" onRetry={() => void query.refetch()} /> : <>
      {pages[0]?.items.length === 0 && <p className={styles.meta}>No project execution bindings configured.</p>}
      <ul className={styles.list} aria-label="Project execution bindings">
        {items.map(p => <li className={styles.card} key={p.id} data-project-id={p.id}>
          <div className={styles.heading}><h3>{p.name}</h3><span className={styles.state} data-started={p.enabled && p.workerPolicy === "enabled" || undefined}>{projectState(p)}</span></div>
          <ProjectControl key={`${p.id}:${queryContext.principalId}:${queryContext.authorizationRevision}`} project={p} onChanged={()=>query.refetch()}/>
          <details className={styles.details}><summary>Configuration and connection details</summary>
          <p className={styles.meta}>Revision {p.revision}</p>
          <dl className={styles.facts}>
            <dt>Repository ID</dt><dd>{p.repositoryId}</dd>
            <dt>Graph workspace ID</dt><dd>{p.workspaceId}</dd>
            <dt>Allowed agent profiles</dt><dd>{p.agents.join(", ")}</dd>
            <dt>Allowed intelligence profiles</dt><dd>{p.intelligence.join(", ")}</dd>
            <dt>Allowed execution profiles</dt><dd>{p.execution.join(", ")}</dd>
            <dt>Allowed worker groups</dt><dd>{p.workerGroups.join(", ") || "None listed"}</dd>
            <dt>Allowed environments</dt><dd>{p.environments.join(", ")}</dd>
          </dl>
          <h4>Recorded external checks</h4>
          <p>Repository: {validationLabel(p.validation.repository)} · Graph: {validationLabel(p.validation.graph)}</p>
          <p>Observed <Timestamp iso={p.validation.observedAt} /></p>
          <details><summary>Identifiers and check times</summary>
          <dl className={styles.facts}>
            <dt>Project ID</dt><dd>{p.id}</dd>
            <dt>Repository binding generation</dt><dd>{p.repositoryGeneration}</dd>
            <dt>Explicitly allowed worker node IDs</dt><dd>{p.nodeIds.join(", ") || "None individually listed"}</dd>
            <dt>Enrolled machines</dt><dd>{p.enrolledNodes ? "allowed" : "not allowed"}</dd>
            <dt>Catalog digest</dt><dd>{p.catalogDigest}</dd>
            <dt>Check observed at</dt><dd><Timestamp iso={p.validation.observedAt} /></dd>
            <dt>Check expiry</dt><dd><Timestamp iso={p.validation.expiresAt} /></dd>
            <dt>Binding validated at</dt><dd><Timestamp iso={p.validation.recordedAt} /></dd>
          </dl>
          <p>Worker admission uses listed node IDs or configured group membership.</p>
          </details>
          </details>
        </li>)}
      </ul>
      {query.hasNextPage && <button type="button" className={styles.more} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more project bindings</button>}
      {pages.length === MAX_PAGES && pages[MAX_PAGES - 1]!.next && <p>Showing the first {MAX_PAGES * PROJECT_PAGE_SIZE} bindings. Additional bindings are not displayed.</p>}
    </>}
  </Panel>;
}
