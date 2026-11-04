import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, ApiError } from "../../api/client";
import { adaptDecision, adaptDecisions, validateAnswerReceipt, type DecisionDetail } from "../../api/adapters/decisions";
import { queryKey } from "../../api/queryKeys";
import { PageTitle } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { Icon } from "../../components/icons";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ChevronLeft } from "lucide-react";
import { DecisionContext } from "./DecisionContext";
import { DecisionEvidence } from "./DecisionEvidence";
import { DecisionInbox, type InboxState } from "./DecisionInbox";
import styles from "./Decisions.module.css";
const ROOT = "/api/reviews/decisions";
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
  if (!read.data || read.isError) return <Panel title="Decision evidence"><QueryStatus status={read.isError ? "error" : "pending"} error={read.error} label="decision evidence" onRetry={() => void read.refetch()} /></Panel>;
  const d = read.data;
  if (project && d.projectId !== project) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this review.</p></Panel>;
  return <><DecisionEvidence detail={d} onRefresh={() => void read.refetch()}>
    <DecisionAction key={`${id}:${d.revision}`} detail={d} enabled={bootstrap.capability("decisions.resolve").enabled} onRecorded={() => { void read.refetch(); void client.invalidateQueries({ queryKey: queryKey(queryContext, "decision-inbox", {}) .slice(0, 5) }); }} />
  </DecisionEvidence><DecisionContext detail={d} updatedAt={read.dataUpdatedAt} className={styles.context} /></>;
}
type Answer = { schema_version: 1; operation_id: string; decision_id: string; expected_decision_revision: number; choice: "approve" | "reject"; comment: string | null };
function DecisionAction({ detail: d, enabled, onRecorded }: { detail: DecisionDetail; enabled: boolean; onRecorded(): void }) {
  const { queryContext, reportIncompatible } = useSession();
  const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Answer | null>(null);
  const available = enabled && d.state === "pending" && d.revision === 1 && d.current && d.eligible;
  async function submit(choice?: "approve" | "reject") {
    if (busy || !available) return;
    if (!pending.current && new TextEncoder().encode(note.trim()).length > 2048) { setStatus("Please shorten the note before sending."); return; }
    const answer = pending.current ?? { schema_version: 1 as const, operation_id: crypto.randomUUID(), decision_id: d.decisionId, expected_decision_revision: d.revision, choice: choice!, comment: note.trim() || null };
    pending.current = answer; setBusy(true); setStatus("Submitting decision…");
    try {
      const receipt = await apiSend<unknown>("POST", `${ROOT}/${d.decisionId}/resolve`, answer);
      // Inspect the authoritative detail to validate and show finality rather than
      // inferring success from an arbitrary HTTP response body.
      validateAnswerReceipt(receipt, d, answer.operation_id, answer.choice, queryContext.principalId);
      setStatus("Decision recorded. Refreshing evidence…"); setUncertain(false); onRecorded();
    } catch (error) {
      if (error instanceof ApiError && error.status === 426) { reportIncompatible("decisions.resolve"); setStatus("Answering requires a compatible AQ API. Your note is preserved."); setUncertain(false); return; }
      if (error instanceof ApiError && [400, 403, 404, 409].includes(error.status ?? 0)) { setStatus(error.status === 409 ? "The review changed. Your note is preserved; refresh the evidence before answering again." : "The server refused this answer. Your note is preserved."); setUncertain(false); }
      else { setStatus("Delivery is unknown. Inspect the review or retry the same answer; no new answer has been created."); setUncertain(true); }
    } finally { setBusy(false); }
  }
  return <><h3>Your decision</h3>{!available && note && <label>Decision note<textarea className={styles.note} readOnly value={note}/></label>}{!available ? <p>{d.state !== "pending" ? "This review has a recorded disposition." : "Answering is unavailable for this review or installation."}</p> : <>
    <label htmlFor={`decision-note-${d.decisionId}`}>Decision note</label><textarea id={`decision-note-${d.decisionId}`} className={styles.note} value={note} maxLength={2048} disabled={busy || pending.current !== null} onChange={e => setNote(e.target.value)} />
    <p className={styles.muted}>Applies to decision revision {d.revision}. The server rechecks current authority and source.</p>
    <div className={styles.actions}>{!pending.current ? <><ActionButton disabled={busy} onClick={() => void submit("approve")}>Approve revision {d.revision}</ActionButton><ActionButton disabled={busy} onClick={() => void submit("reject")}>Request changes</ActionButton></> : uncertain && <ActionButton disabled={busy} onClick={() => void submit()}>Retry same answer</ActionButton>}</div>
  </>}{status && <p role="status">{status}</p>}</>;
}
