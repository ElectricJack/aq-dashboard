import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, ApiError } from "../../api/client";
import { adaptDecision, adaptDecisions, validateAnswerReceipt, type DecisionDetail } from "../../api/adapters/decisions";
import { queryKey } from "../../api/queryKeys";
import { PageTitle } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { ActionButton, DetailList, Panel, Toolbar } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import styles from "./Decisions.module.css";
const ROOT = "/api/reviews/decisions";
const short = (id: string) => id.slice(0, 8);
export function Component() {
  const { bootstrap, queryContext } = useSession();
  const permission = bootstrap.capability("decisions.read");
  const [scope] = useScope(); const search = scopeSearch(scope);
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
  return <><div className={styles.heading}><PageTitle>Decisions</PageTitle><span className={styles.muted}>Revision-bound human reviews</span></div>
    {!permission.enabled ? <p role="status">{permission.reason}</p> : <>
      <Toolbar aria-label="Decision filters">{(["open", "closed"] as const).map(s => <ActionButton key={s} aria-pressed={s === state} onClick={() => setParams(old => { const next = new URLSearchParams(old); next.set("state", s); return next; })}>{s === "open" ? "Open" : "Resolved"}</ActionButton>)}<ActionButton onClick={() => void inbox.refetch()} disabled={inbox.isFetching}>Refresh</ActionButton></Toolbar>
      <p className={styles.muted}>Showing sampled reviews available to your current owner account. No total or task impact is inferred.</p>
      <div className={styles.layout}>
        <Panel title="Review inbox">
          {!inbox.data || inbox.isError ? <QueryStatus status={inbox.isError ? "error" : "pending"} error={inbox.error} label="review inbox" onRetry={() => void inbox.refetch()} /> : <>
            {unique.length === 0 && <p>No available reviews in this page.</p>}
            <ul className={styles.inbox}>{unique.map(r => <li key={r.decisionId}><Link className={styles.row} aria-current={decisionId === r.decisionId ? "page" : undefined} to={{ pathname: `/decisions/${r.decisionId}`, search: new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString() }}><strong>Review task {short(r.taskId)}</strong><span className={styles.muted}>Project {short(r.projectId)} · Revision {r.revision}</span><span>{r.state === "pending" ? "Awaiting decision" : r.state}</span>{!r.current && <span className={styles.muted}>Result has a newer report</span>}</Link></li>)}</ul>
            {inbox.hasNextPage && <ActionButton disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>Load more reviews</ActionButton>}
            {inbox.data.pages.length === 4 && inbox.data.pages[3]?.cursor && <p>Page limit reached. Refresh to begin again.</p>}
          </>}
        </Panel>
        {decisionId ? <Selected key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${decisionId}:${project ?? "all"}`} id={decisionId} project={project} /> : <Panel title="Choose a review"><p>Select an available decision to inspect its exact result and evidence.</p></Panel>}
      </div>
    </>}
    <Link to={{ pathname: "/work", search }}>Open Work</Link>
  </>;
}
function Selected({ id, project }: { id: string; project: string | undefined }) {
  const { queryContext, bootstrap } = useSession();
  const client = useQueryClient();
  const read = useQuery({ queryKey: queryKey(queryContext, "decision-detail", { id }), queryFn: async ({ signal }) => adaptDecision(await apiGet(`${ROOT}/${encodeURIComponent(id)}`, signal), id, queryContext.principalId), retry: false });
  if (!read.data || read.isError) return <Panel title="Decision evidence"><QueryStatus status={read.isError ? "error" : "pending"} error={read.error} label="decision evidence" onRetry={() => void read.refetch()} /></Panel>;
  const d = read.data;
  if (project && d.projectId !== project) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this review.</p></Panel>;
  return <><Panel title={`Review task ${short(d.taskId)}`} description={`Decision revision ${d.revision} · Task version ${d.taskVersion}`} actions={<ActionButton onClick={() => void read.refetch()}>Refresh evidence</ActionButton>}>
    <p className={styles.status}>{d.finality ? `Recorded decision: ${d.finality}` : d.state === "pending" ? "Awaiting your decision" : d.state}</p>
    {!d.current && <p role="status">A newer result report exists. This review remains historical evidence.</p>}
    {d.conclusion && <><h3>Recorded result</h3><p>{d.conclusion}</p><p className={styles.muted}>Reported process outcome: {d.processOutcome}</p></>}
    <h3>Review criteria</h3><ul>{d.criteria.map(c => <li key={c}>{c}</li>)}</ul>
    <h3>Source evidence</h3><DetailList><dt>Repository</dt><dd>{d.source.repository}</dd><dt>Base object</dt><dd>{d.source.base}</dd><dt>Resulting object</dt><dd>{d.source.result}</dd></DetailList>
    <DecisionAction key={`${id}:${d.revision}`} detail={d} enabled={bootstrap.capability("decisions.resolve").enabled} onRecorded={() => { void read.refetch(); void client.invalidateQueries({ queryKey: queryKey(queryContext, "decision-inbox", {}) .slice(0, 5) }); }} />
  </Panel><Panel title="Decision context" className={styles.context}><DetailList><dt>Project</dt><dd>{d.projectId}</dd><dt>Task</dt><dd>{d.taskId}</dd><dt>Report</dt><dd>{d.reportId}</dd></DetailList><h3>Pinned evidence</h3><ul className={styles.artifacts}>{d.evidence.map(e => <li key={e.label}><strong>{e.label}</strong><span className={styles.muted}>{e.id}</span><code>{e.digest}</code></li>)}</ul><p className={styles.muted}>A recorded answer does not establish task completion or source publication.</p></Panel></>;
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
