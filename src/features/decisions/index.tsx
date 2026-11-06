import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { validGraphId } from "../../api/adapters/humanGraph";
import { adaptDecision, adaptDecisions } from "../../api/adapters/decisions";
import { adaptQuestion, adaptQuestions, QUESTIONS_READ, QUESTIONS_ROOT } from "../../api/adapters/questions";
import { queryKey } from "../../api/queryKeys";
import { PageTitle } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { Panel } from "../../components/layout/Workspace";
import { Icon } from "../../components/icons";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ChevronLeft } from "lucide-react";
import { DecisionAction } from "./DecisionAction";
import { DecisionContext } from "./DecisionContext";
import { DecisionEvidence } from "./DecisionEvidence";
import { DecisionInbox, type InboxState } from "./DecisionInbox";
import { QuestionAnswer, QuestionContext, QuestionPanel } from "./QuestionDetail";
import styles from "./Decisions.module.css";
const ROOT = "/api/reviews/decisions";
export function Component() {
  const { bootstrap, queryContext } = useSession();
  const permission = bootstrap.capability("decisions.read");
  const [scope] = useScope();
  const [params, setParams] = useSearchParams(); const state = params.get("state") === "closed" ? "closed" : "open";
  const { decisionId } = useParams();
  // `?kind=question` selects an F5 agent question; review links carry no kind.
  const question = params.get("kind") === "question";
  const questionsOffered = permission.enabled && bootstrap.capability(QUESTIONS_READ).enabled;
  const project = scope.kind === "project" ? scope.project_id : undefined;
  const inbox = useInfiniteQuery({
    queryKey: queryKey(queryContext, "decision-inbox", { project, state }), enabled: permission.enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => { const q = new URLSearchParams({ state, limit: "25" }); if (project) q.set("project_id", project); if (pageParam) q.set("cursor", pageParam); return adaptDecisions(await apiGet(`${ROOT}?${q}`, signal), project); },
    getNextPageParam: (last, pages) => pages.length < 4 ? last.cursor ?? undefined : undefined,
  });
  const questions = useQuery({
    queryKey: queryKey(queryContext, "question-inbox", { project, state }), enabled: questionsOffered,
    queryFn: async ({ signal }) => { const q = new URLSearchParams({ state, limit: "25" }); if (project) q.set("project_id", project); return adaptQuestions(await apiGet(`${QUESTIONS_ROOT}?${q}`, signal), state === "open", project); },
  });
  const asked = questionsOffered && !questions.isError ? questions.data?.items.length ?? 0 : 0;
  const rows = inbox.data?.pages.flatMap(p => p.items);
  const unique = rows ? [...new Map(rows.map(r => [r.decisionId, r])).values()] : [];
  const last = inbox.data?.pages.at(-1);
  const setState = (s: InboxState) => setParams(old => { const next = new URLSearchParams(old); next.set("state", s); return next; });
  const back = new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString();
  return <><div className={styles.heading}><PageTitle>Decisions</PageTitle>{permission.enabled && inbox.data && !inbox.isError && <p className={styles.subtitle}>{unique.length + asked} shown · sampled from your reviews{questionsOffered ? " and agent questions" : ""}</p>}</div>
    {!permission.enabled ? <p role="status">{permission.reason}</p> : <>
      <div className={[styles.layout, decisionId && styles.selected].filter(Boolean).join(" ")}>
        <DecisionInbox className={styles.inboxPane} state={state} onState={setState} rows={inbox.data && !inbox.isError ? unique : undefined} error={inbox.isError ? inbox.error : undefined}
          serverTime={last?.serverTime} updatedAt={inbox.dataUpdatedAt} selected={decisionId} project={project} fetching={inbox.isFetching || questions.isFetching} onRefresh={() => { void inbox.refetch(); if (questionsOffered) void questions.refetch(); }}
          questions={questionsOffered ? { rows: questions.data?.items, error: questions.isError ? questions.error : undefined, more: !!questions.data?.cursor, serverTime: questions.data?.serverTime, updatedAt: questions.dataUpdatedAt } : undefined}
          more={{ available: inbox.hasNextPage, loading: inbox.isFetchingNextPage, load: () => void inbox.fetchNextPage(), limitReached: inbox.data?.pages.length === 4 && !!inbox.data.pages[3]?.cursor }} />
        {decisionId && <Link className={styles.back} to={{ pathname: "/decisions", search: back }}><Icon icon={ChevronLeft} size={18} />All decisions</Link>}
        {/* A malformed id can never load: neutral not-found, never a retryable error (WD-13). */}
        {decisionId && !validGraphId(decisionId) ? <Panel title={question ? "Agent question" : "Decision"}><p role="status">This item does not exist or is not available to you.</p></Panel>
        : decisionId && question ? <SelectedQuestion key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${decisionId}:${project ?? "all"}`} id={decisionId} project={project} />
        : decisionId ? <Selected key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${decisionId}:${project ?? "all"}`} id={decisionId} project={project} /> : <>
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
  const read = useQuery({ queryKey: queryKey(queryContext, "decision-detail", { id }), queryFn: async ({ signal }) => adaptDecision(await apiGet(`${ROOT}/${encodeURIComponent(id)}`, signal), id, queryContext.principalId) });
  // Completed deliberate refreshes; the decision bar uses this to release a refused answer.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = () => read.refetch().then(r => { if (!r.isError) setRefreshes(n => n + 1); return r; });
  if (!read.data || read.isError) return <Panel title="Decision evidence"><QueryStatus status={read.isError ? "error" : "pending"} error={read.error} subject="item" label="decision evidence" onRetry={() => void read.refetch()} /></Panel>;
  const d = read.data;
  if (project && d.projectId !== project) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this review.</p></Panel>;
  return <><DecisionEvidence detail={d} onRefresh={() => void refresh()} /><DecisionContext detail={d} updatedAt={read.dataUpdatedAt} className={styles.context} />
  <DecisionAction detail={d} capability={bootstrap.capability("decisions.resolve")} refreshes={refreshes} onRefresh={refresh} onRecorded={() => { void read.refetch(); void client.invalidateQueries({ queryKey: queryKey(queryContext, "decision-inbox", {}) .slice(0, 5) }); }} /></>;
}

/** An F5 agent question: its exact text, task and expiry, and the `question.answer` bar. */
function SelectedQuestion({ id, project }: { id: string; project: string | undefined }) {
  const { queryContext, bootstrap } = useSession();
  const client = useQueryClient();
  const offered = bootstrap.capability(QUESTIONS_READ);
  const read = useQuery({ queryKey: queryKey(queryContext, "question-detail", { id }), enabled: offered.enabled,
    queryFn: async ({ signal }) => adaptQuestion(await apiGet(`${QUESTIONS_ROOT}/${encodeURIComponent(id)}`, signal), id) });
  const [refreshes, setRefreshes] = useState(0);
  const refresh = () => read.refetch().then(r => { if (!r.isError) setRefreshes(n => n + 1); return r; });
  if (!offered.enabled) return <Panel title="Agent question"><p role="status">{offered.reason}</p></Panel>;
  if (!read.data || read.isError) return <Panel title="Agent question"><QueryStatus status={read.isError ? "error" : "pending"} error={read.error} subject="item" label="agent question" onRetry={() => void read.refetch()} /></Panel>;
  const { item: q, serverTime } = read.data;
  if (project && q.projectId !== project) return <Panel title="Question outside selected scope"><p>Select its project or return to All projects to answer this question.</p></Panel>;
  return <><QuestionPanel question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt}>
      <QuestionAnswer question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt} refreshes={refreshes} onRefresh={refresh} onRecorded={() => { void read.refetch(); void client.invalidateQueries({ queryKey: queryKey(queryContext, "question-inbox", {}).slice(0, 5) }); }} />
    </QuestionPanel>
    <QuestionContext question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt} className={styles.context} /></>;
}
