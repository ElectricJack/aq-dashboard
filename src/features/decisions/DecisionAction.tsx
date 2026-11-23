import { useDecisionBar, keepClearOf } from "./useDecisionBar";
import { useRefusedRefresh } from "./decisionHooks";
import { useId, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { apiSend, ApiError } from "../../api/client";
import { validateAnswerReceipt, type DecisionDetail } from "../../api/adapters/decisions";
import type { CapabilityState } from "../../api/adapters/bootstrap";
import { useSession } from "../../app/session";
import { Icon } from "../../components/icons";
import { ActionButton } from "../../components/layout/Workspace";
import { shortId } from "./DecisionContext";
import styles from "./DecisionAction.module.css";

const ROOT = "/api/reviews/decisions";
type Answer = { schema_version: 1; operation_id: string; decision_id: string; expected_decision_revision: number; choice: "approve" | "reject"; comment: string | null };

/** One specific reason the signed-in owner cannot answer this review, or null when they can. */
export function unavailableReason(d: DecisionDetail, capability: CapabilityState): string | null {
  if (d.state !== "pending" || d.revision !== 1) return "This review has a recorded disposition.";
  if (!capability.enabled) return capability.reason;
  if (!d.current) return "A newer result exists — this review is historical.";
  if (!d.eligible) return "You aren't an eligible owner for this review.";
  return null;
}

/**
 * Reference 03 decision bar: note, the exact subject the answer binds, Approve (primary)
 * and Request changes. Pending answers stay frozen until the server confirms; a refusal
 * keeps the draft and offers a deliberate evidence refresh before answering again.
 */
type DecisionActionProps = {
  detail: DecisionDetail; capability: CapabilityState;
  /** Count of completed deliberate evidence refreshes (from any Refresh evidence control). */
  refreshes: number; onRefresh(): Promise<unknown>; onRecorded(): void;
};

export function DecisionAction(props: DecisionActionProps) {
  const { detail: d, capability } = props;
  const reason = unavailableReason(d, capability);
  const available = reason === null;
  const submission = useDecisionSubmission(props, available);
  const { note, setNote, status, busy, pending } = submission;
  const noteId = useId(); const metaId = useId();
  const { noteRef, rowRef, barRef } = useDecisionBar(available);
  const subject = `task version ${d.taskVersion} · report ${shortId(d.reportId)}`;
  const frozen = busy || pending.current !== null;
  return <section ref={barRef} className={styles.bar} data-decision-bar="" aria-label="Your decision">
    {(available || note) && <div className={styles.field}>
      <Icon icon={MessageSquare} size={20} className={styles.fieldIcon} />
      <textarea ref={noteRef} id={noteId} className={styles.note} aria-label="Decision note" aria-describedby={metaId} placeholder="Add a decision note…" rows={1}
        value={note} maxLength={2048} readOnly={!available} disabled={available && frozen}
        onChange={e => setNote(e.target.value)} onFocus={e => { const el = e.currentTarget; requestAnimationFrame(() => keepClearOf(el, rowRef.current)); }} />
    </div>}
    <div ref={rowRef} className={styles.row} data-decision-actions="">
      <div className={styles.meta}>
        <p id={metaId} className={styles.applies}>Decision applies only to {subject}.</p>
        {reason && <p className={styles.reason}>{reason}</p>}
        {status && <p role="status" className={styles.status}>{status}</p>}
      </div>
      {available && <DecisionButtons submission={submission} taskVersion={d.taskVersion} />}
    </div>
  </section>;
}

function DecisionButtons({ submission, taskVersion }: { submission: ReturnType<typeof useDecisionSubmission>; taskVersion: number }) {
  const { pending, outcome, busy, submit, refresh } = submission;
  return <div className={styles.buttons}>
    {!pending.current ? <>
      <ActionButton className={styles.primary} disabled={busy} onClick={() => void submit("approve")}>Approve task version {taskVersion}</ActionButton>
      <ActionButton className={styles.secondary} disabled={busy} onClick={() => void submit("reject")}>Request changes</ActionButton>
    </> : outcome === "uncertain" ? <ActionButton className={styles.secondary} disabled={busy} onClick={() => void submit()}>Retry same answer</ActionButton>
      : outcome === "refused" && <ActionButton className={styles.secondary} disabled={busy} onClick={() => void refresh()}>Refresh evidence and answer again</ActionButton>}
  </div>;
}

function newDecisionAnswer(detail: DecisionDetail, choice: Answer["choice"], note: string): Answer {
  return {
    schema_version: 1, operation_id: crypto.randomUUID(), decision_id: detail.decisionId,
    expected_decision_revision: detail.revision, choice, comment: note.trim() || null,
  };
}

async function sendDecisionAnswer(answer: Answer, detail: DecisionDetail, principal: string) {
  const receipt = await apiSend<unknown>("POST", `${ROOT}/${detail.decisionId}/resolve`, answer);
  validateAnswerReceipt(receipt, detail, answer.operation_id, answer.choice, principal);
}

function useDecisionSubmission({ detail: d, refreshes, onRefresh, onRecorded }: DecisionActionProps, available: boolean) {
  const { queryContext, reportIncompatible } = useSession();
  const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"uncertain" | "refused" | null>(null);
  const pending = useRef<Answer | null>(null);
  useRefusedRefresh(refreshes, outcome === "refused", () => {
    pending.current = null; setOutcome(null); setStatus("Evidence refreshed. Review it, then answer again. Your note is preserved.");
  });

  async function submit(choice?: "approve" | "reject") {
    if (busy || !available) return;
    if (!pending.current && new TextEncoder().encode(note.trim()).length > 2048) { setStatus("Please shorten the note before sending."); return; }
    const answer = pending.current ?? newDecisionAnswer(d, choice!, note);
    pending.current = answer; setBusy(true); setStatus("Submitting decision…");
    try {
      await sendDecisionAnswer(answer, d, queryContext.principalId);
      setStatus("Decision recorded. Refreshing evidence…"); setOutcome(null); onRecorded();
    } catch (error) {
      const failure = decisionFailure(error);
      if (failure.outcome === null) reportIncompatible("decisions.resolve");
      setStatus(failure.message);
      setOutcome(failure.outcome);
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setStatus("Refreshing evidence…");
    try { await onRefresh(); } finally { setBusy(false); }
  }

  return { note, setNote, status, busy, outcome, pending, submit, refresh };
}

type Refusal = { outcome: "uncertain" | "refused" | null; message: string };
const REFUSED: Refusal = { outcome: "refused", message: "The server refused this answer. Your note is preserved; refresh the evidence before answering again." };
const FAILURES: Partial<Record<number, Refusal>> = {
  400: REFUSED, 403: REFUSED, 404: REFUSED,
  409: { outcome: "refused", message: "The review changed. Your note is preserved; refresh the evidence before answering again." },
  426: { outcome: null, message: "Answering requires a compatible AQ API. Your note is preserved." },
};
function decisionFailure(error: unknown): Refusal {
  const status = error instanceof ApiError ? error.status : undefined;
  return FAILURES[status ?? 0] ?? { outcome: "uncertain", message: "Delivery is unknown. Inspect the review or retry the same answer; no new answer has been created." };
}
