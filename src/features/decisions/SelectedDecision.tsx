import { useState, type ReactNode } from "react";
import { adaptQuestion, QUESTIONS_READ, QUESTIONS_ROOT } from "../../api/adapters/questions";
import { useSession } from "../../app/session";
import { Panel } from "../../components/layout/Workspace";
import styles from "./Decisions.module.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { adaptDecision } from "../../api/adapters/decisions";
import { queryKey } from "../../api/queryKeys";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { DecisionAction } from "./DecisionAction";
import { DecisionContext } from "./DecisionContext";
import { DecisionEvidence } from "./DecisionEvidence";
import { QuestionAnswer, QuestionContext, QuestionPanel } from "./QuestionDetail";

const ROOT = "/api/reviews/decisions";

export function StatusPanel({ title, children }: { title: string; children: ReactNode }) {
  return <Panel title={title}><p role="status">{children}</p></Panel>;
}

function useEvidenceRefresh(read: { refetch(): Promise<{ isError: boolean }> }, inbox: string) {
  const client = useQueryClient();
  const { queryContext } = useSession();
  // Only a successful, deliberate refresh releases the refused answer.
  const [refreshes, setRefreshes] = useState(0);
  async function refresh() {
    const result = await read.refetch();
    if (!result.isError) setRefreshes(n => n + 1);
    return result;
  }
  function recorded() {
    void read.refetch();
    void client.invalidateQueries({ queryKey: queryKey(queryContext, inbox, {}).slice(0, 5) });
  }
  return { refreshes, refresh, recorded };
}

function EvidenceStatus({ title, label, read }: { title: string; label: string; read: { isError: boolean; error: unknown; refetch(): Promise<unknown> } }) {
  return <Panel title={title}><QueryStatus status={read.isError ? "error" : "pending"} error={read.error}
    subject="item" label={label} onRetry={() => void read.refetch()} /></Panel>;
}

export function Selected({ id, project }: { id: string; project: string | undefined }) {
  const { queryContext, bootstrap } = useSession();
  const read = useQuery({ queryKey: queryKey(queryContext, "decision-detail", { id }), queryFn: async ({ signal }) => adaptDecision(await apiGet(`${ROOT}/${encodeURIComponent(id)}`, signal), id, queryContext.principalId) });
  const { refreshes, refresh, recorded } = useEvidenceRefresh(read, "decision-inbox");
  if (!read.data || read.isError) return <EvidenceStatus title="Decision evidence" label="decision evidence" read={read} />;
  const d = read.data;
  if (project && d.projectId !== project) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this review.</p></Panel>;
  return <><DecisionEvidence detail={d} onRefresh={() => void refresh()} /><DecisionContext detail={d} updatedAt={read.dataUpdatedAt} className={styles.context} />
  <DecisionAction detail={d} capability={bootstrap.capability("decisions.resolve")} refreshes={refreshes} onRefresh={refresh} onRecorded={recorded} /></>;
}

/** An F5 agent question: its exact text, task and expiry, and the `question.answer` bar. */
export function SelectedQuestion({ id, project }: { id: string; project: string | undefined }) {
  const { queryContext, bootstrap } = useSession();
  const offered = bootstrap.capability(QUESTIONS_READ);
  const read = useQuery({ queryKey: queryKey(queryContext, "question-detail", { id }), enabled: offered.enabled,
    queryFn: async ({ signal }) => adaptQuestion(await apiGet(`${QUESTIONS_ROOT}/${encodeURIComponent(id)}`, signal), id) });
  const { refreshes, refresh, recorded } = useEvidenceRefresh(read, "question-inbox");
  if (!offered.enabled) return <StatusPanel title="Agent question">{offered.reason}</StatusPanel>;
  if (!read.data || read.isError) return <EvidenceStatus title="Agent question" label="agent question" read={read} />;
  const { item: q, serverTime } = read.data;
  if (project && q.projectId !== project) return <Panel title="Question outside selected scope"><p>Select its project or return to All projects to answer this question.</p></Panel>;
  return <><QuestionPanel question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt}>
      <QuestionAnswer question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt} refreshes={refreshes} onRefresh={refresh} onRecorded={recorded} />
    </QuestionPanel>
    <QuestionContext question={q} serverTime={serverTime} updatedAt={read.dataUpdatedAt} className={styles.context} /></>;
}
