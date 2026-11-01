import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { apiGet } from "../../api/client";
import { ContractError } from "../../api/adapters/contract";
import { adaptResults, type ResultMetadata } from "../../api/adapters/results";
import { scopedKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./Results.module.css";

function Record({ item, exact }: { item: ResultMetadata; exact: boolean }) {
  const [scope] = useScope();
  const { bootstrap } = useSession();
  const search = scopeSearch(scope);
  const date = new Date(item.recorded_at_ms).toISOString();
  return <article className={styles.card} aria-label={`Recorded result ${item.report_id}`}>
    <div className={styles.header}><h2 className={styles.title}>{exact ? "Recorded result" : <Link to={{ pathname: `/results/${item.report_id}/revisions/${item.revision}`, search }}>Recorded result</Link>}</h2><span className={styles.badge}>{item.current_report_head ? "Current report" : "Superseded report"}</span></div>
    <p className={styles.meta}>Task {bootstrap.capability("tasks.read").enabled ? <Link to={{ pathname: `/work/${item.task_id}`, search }}>{item.task_id}</Link> : item.task_id} · Project {item.project_id}</p>
    <p className={styles.summary}>{item.conclusion}</p>
    <p>Worker-reported outcome: <strong>{item.process_outcome}</strong></p>
    <p className={styles.meta}>Recorded <time dateTime={date}>{date}</time> · Acceptance and task settlement are not evaluated by this view.</p>
    <div className={exact ? styles.detail : undefined}>
      <dl className={styles.facts}><dt>Attempt</dt><dd>{item.attempt_id}</dd><dt>Report</dt><dd>{item.report_id}</dd><dt>Exact revision</dt><dd>{item.revision}</dd><dt>Repository</dt><dd>{item.repository_id}</dd><dt>Source base</dt><dd>{item.source_base.hex}</dd>{item.supersedes && <><dt>Corrects report</dt><dd>{item.supersedes}</dd></>}</dl>
      <section className={styles.evidence} aria-label="Reported evidence references"><h3>Evidence references</h3><p className={styles.meta}>References supplied with the worker report. These references do not establish verification or acceptance.</p><p>Source receipts: {item.source_receipt_ids.length}</p>{exact && item.source_receipt_ids.map(id => <p key={id} className={styles.meta}>{id}</p>)}<p>Pending effects: {item.pending_effect_ids.length}</p>{exact && item.pending_effect_ids.map(id => <p key={id} className={styles.meta}>{id}</p>)}</section>
    </div>
  </article>;
}
export function Results() {
  const [scope] = useScope();
  const { resultId, revision } = useParams();
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability("results.read");
  const project = scope.kind === "project" ? scope.project_id : undefined;
  const exact = resultId && revision ? { id: resultId, revision } : undefined;
  const query = useInfiniteQuery({
    queryKey: scopedKey(queryContext, scope, "result-metadata", { id: resultId, revision }),
    enabled: capability.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (project) params.set("project_id", project);
      if (!exact) params.set("limit", "10");
      if (pageParam) params.set("after", pageParam);
      const path = exact ? `/api/human/results/${encodeURIComponent(exact.id)}/revisions/${encodeURIComponent(exact.revision)}` : "/api/human/results";
      const page = adaptResults(await apiGet<unknown>(`${path}?${params}`, signal), project, exact, pageParam ?? undefined);
      if (!exact && page.items.length > 10) throw new ContractError("Result page exceeded requested limit");
      return page;
    },
    getNextPageParam: (last, all) => !exact && all.length < 4 ? last.next_after ?? undefined : undefined,
    retry: false,
  });
  if (!capability.enabled) return <p>{capability.reason}</p>;
  if (!query.data || query.isError) return <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="retained results" onRetry={() => void query.refetch()} />;
  const pages = query.data.pages;
  const items = pages.flatMap(p => p.items);
  const ids = new Set(items.map(v => v.report_id));
  if (ids.size !== items.length) return <p role="alert">Result pages changed. Refresh to reload the recorded reports.</p>;
  return <div className={styles.layout}>
    <p className={styles.intro}>Recorded worker reports and their exact evidence references.</p>
    <div className={styles.toolbar}>{exact ? <Link to={{ pathname: "/results", search: scopeSearch(scope) }}>Back to results</Link> : <span className={styles.tab}>Recorded reports</span>}<ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh results</ActionButton></div>
    <p className={styles.meta}>Coverage: retained legacy native reports. Reports are ordered by stable identity. Media and discussion are not available in this increment.</p>
    {items.length === 0 ? <p>No recorded result reports in this scope.</p> : <ul className={styles.feed} aria-label="Recorded results">{items.map(item => <li key={item.report_id}><Record item={item} exact={!!exact} /></li>)}</ul>}
    {query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more recorded results</ActionButton>}
    {pages.length === 4 && pages[3]?.next_after && <p>Showing the first 40 reports. Additional reports are not displayed.</p>}
  </div>;
}
