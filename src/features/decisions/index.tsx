import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { adaptDecision, adaptDecisions } from "../../api/adapters/decisions";
import { queryKey } from "../../api/queryKeys";
import { PageTitle } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { ActionButton, DetailList, Panel } from "../../components/layout/Workspace";
import { Icon } from "../../components/icons";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ChevronLeft } from "lucide-react";
import { DecisionAction } from "./DecisionAction";
import { DecisionContext } from "./DecisionContext";
import { DecisionInbox, type InboxState } from "./DecisionInbox";
import styles from "./Decisions.module.css";
const ROOT = "/api/reviews/decisions";
const short = (id: string) => id.slice(0, 8);
export function Component() {
  const { bootstrap, queryContext } = useSession();
  const permission = bootstrap.capability("decisions.read");
  const [scope] = useScope();
  const [params, setParams] = useSearchParams(); const state = params.get("state") === "closed" ? "closed" : "open";
  const { decisionId } = useParams();
  const project = scope.kind === "project" ? scope.project_id : undefined;
  const inbox = useInfiniteQuery({
    queryKey: queryKey(queryContext, "decision-inbox", { project, state }), enabled: permission.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => { const q = new URLSearchParams({ state, limit: "25" }); if (project) q.set("project_id", project); if (pageParam) q.set("cursor", pageParam); return adaptDecisions(await apiGet(`${ROOT}?${q}`, signal), project); },
    getNextPageParam: (last, pages) => pages.length < 4 ? last.cursor ?? undefined : undefined, retry: false,
  });
  const rows = inbox.data?.pages.flatMap(p => p.items);
  const unique = rows ? [...new Map(rows.map(r => [r.decisionId, r])).values()] : [];
  const last = inbox.data?.pages.at(-1);
  const setState = (s: InboxState) => setParams(old => { const next = new URLSearchParams(old); next.set("state", s); return next; });
  const back = new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString();
  return <><div className={styles.heading}><PageTitle>Decisions</PageTitle>{permission.enabled && inbox.data && !inbox.isError && <p className={styles.subtitle}>{unique.length} shown · sampled from your reviews</p>}</div>
    {!permission.enabled ? <p role="status">{permission.reason}</p> : <>
      <div className={[styles.layout, decisionId && styles.selected].filter(Boolean).join(" ")}>
        <DecisionInbox className={styles.inboxPane} state={state} onState={setState} rows={inbox.data && !inbox.isError ? unique : undefined} error={inbox.isError ? inbox.error : undefined}
          serverTime={last?.serverTime} updatedAt={inbox.dataUpdatedAt} selected={decisionId} project={project} fetching={inbox.isFetching} onRefresh={() => void inbox.refetch()}
          more={{ available: inbox.hasNextPage, loading: inbox.isFetchingNextPage, load: () => void inbox.fetchNextPage(), limitReached: inbox.data?.pages.length === 4 && !!inbox.data.pages[3]?.cursor }} />
        {decisionId && <Link className={styles.back} to={{ pathname: "/decisions", search: back }}><Icon icon={ChevronLeft} size={18} />All decisions</Link>}
        {decisionId ? <Selected key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${decisionId}:${project ?? "all"}`} id={decisionId} project={project} /> : <>
          <Panel title="Choose a review" className={styles.placeholder}><p className={styles.muted}>Select a review to inspect its exact result and evidence.</p></Panel>
          <Panel title="Decision context" className={`${styles.context} ${styles.placeholder}`}><p className={styles.muted}>Project, task and evidence for the selected review appear here.</p></Panel>
        </>}
      </div>
    </>}
  </>;
}
function Selected({ id, project }: { id: string; project: string | undefined }) {
  const { queryContext, bootstrap } = useSession();
  const client = useQueryClient();
  const read = useQuery({ queryKey: queryKey(queryContext, "decision-detail", { id }), queryFn: async ({ signal }) => adaptDecision(await apiGet(`${ROOT}/${encodeURIComponent(id)}`, signal), id, queryContext.principalId), retry: false });
  // Completed deliberate refreshes; the decision bar uses this to release a refused answer.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = () => read.refetch().then(r => { if (!r.isError) setRefreshes(n => n + 1); return r; });
  if (!read.data || read.isError) return <Panel title="Decision evidence"><QueryStatus status={read.isError ? "error" : "pending"} error={read.error} label="decision evidence" onRetry={() => void read.refetch()} /></Panel>;
  const d = read.data;
  if (project && d.projectId !== project) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this review.</p></Panel>;
  return <><Panel title={`Review task ${short(d.taskId)}`} description={`Decision revision ${d.revision} · Task version ${d.taskVersion}`} actions={<ActionButton onClick={() => void refresh()}>Refresh evidence</ActionButton>}>
    <p className={styles.status}>{d.finality ? `Recorded decision: ${d.finality}` : d.state === "pending" ? "Awaiting your decision" : d.state}</p>
    {!d.current && <p role="status">A newer result report exists. This review remains historical evidence.</p>}
    {d.conclusion && <><h3>Recorded result</h3><p>{d.conclusion}</p><p className={styles.muted}>Reported process outcome: {d.processOutcome}</p></>}
    <h3>Review criteria</h3><ul>{d.criteria.map(c => <li key={c}>{c}</li>)}</ul>
    <h3>Source evidence</h3><DetailList><dt>Repository</dt><dd>{d.source.repository}</dd><dt>Base object</dt><dd>{d.source.base}</dd><dt>Resulting object</dt><dd>{d.source.result}</dd></DetailList>
  </Panel><DecisionContext detail={d} updatedAt={read.dataUpdatedAt} className={styles.context} />
  <DecisionAction detail={d} capability={bootstrap.capability("decisions.resolve")} refreshes={refreshes} onRefresh={refresh} onRecorded={() => { void read.refetch(); void client.invalidateQueries({ queryKey: queryKey(queryContext, "decision-inbox", {}) .slice(0, 5) }); }} /></>;
}
