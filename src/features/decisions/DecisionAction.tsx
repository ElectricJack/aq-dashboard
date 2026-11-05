import { useEffect, useId, useRef, useState } from "react";
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
 * On phones only the action row is sticky; the note sits in the flow above it. When the
 * note gains focus (or the on-screen keyboard resizes the visible viewport), scroll it
 * clear of the sticky row so the bar never covers the field being typed into.
 */
function keepClearOf(note: HTMLElement, row: HTMLElement | null) {
  if (!row || getComputedStyle(row).position !== "sticky") return;
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const limit = Math.min(row.getBoundingClientRect().top, visibleBottom) - 8;
  const overlap = note.getBoundingClientRect().bottom - limit;
  if (overlap > 0) window.scrollBy({ top: overlap });
}

/**
 * Reference 03 decision bar: note, the exact subject the answer binds, Approve (primary)
 * and Request changes. Pending answers stay frozen until the server confirms; a refusal
 * keeps the draft and offers a deliberate evidence refresh before answering again.
 */
export function DecisionAction({ detail: d, capability, refreshes, onRefresh, onRecorded }: {
  detail: DecisionDetail; capability: CapabilityState;
  /** Count of completed deliberate evidence refreshes (from any Refresh evidence control). */
  refreshes: number; onRefresh(): Promise<unknown>; onRecorded(): void;
}) {
  const { queryContext, reportIncompatible } = useSession();
  const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"uncertain" | "refused" | null>(null);
  const pending = useRef<Answer | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null); const rowRef = useRef<HTMLDivElement>(null);
  const noteId = useId(); const metaId = useId();
  const reason = unavailableReason(d, capability);
  const available = reason === null;
  const subject = `task version ${d.taskVersion} · report ${shortId(d.reportId)}`;

  // A deliberate refresh after a refusal releases the refused answer; the next submit
  // creates a new operation bound to whatever revision the refreshed evidence shows.
  const seenRefreshes = useRef(refreshes);
  useEffect(() => {
    if (refreshes === seenRefreshes.current) return;
    seenRefreshes.current = refreshes;
    if (outcome !== "refused") return;
    pending.current = null; setOutcome(null); setStatus("Evidence refreshed. Review it, then answer again. Your note is preserved.");
  }, [refreshes, outcome]);

  useEffect(() => {
    const vv = window.visualViewport; const el = noteRef.current;
    if (!vv || !el) return;
    const onResize = () => { if (document.activeElement === el) keepClearOf(el, rowRef.current); };
    vv.addEventListener("resize", onResize); return () => vv.removeEventListener("resize", onResize);
  }, [available]);

  // WCAG 2.4.11: reserve the sticky bar's measured height as the page's bottom scroll padding
  // so keyboard focus scrolled into view is never hidden behind the bar (desktop: whole bar;
  // phone: only the action row is sticky).
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current, root = document.documentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const sticky = getComputedStyle(bar).display === "contents" ? rowRef.current : bar;
      if (!sticky) return;
      const inset = parseFloat(getComputedStyle(sticky).insetBlockEnd) || 0;
      root.style.scrollPaddingBlockEnd = `${Math.ceil(sticky.getBoundingClientRect().height + inset + 16)}px`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(bar); if (rowRef.current) observer.observe(rowRef.current);
    window.addEventListener("resize", update); update();
    return () => { observer.disconnect(); window.removeEventListener("resize", update); root.style.removeProperty("scroll-padding-block-end"); };
  }, []);

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
      setStatus("Decision recorded. Refreshing evidence…"); setOutcome(null); onRecorded();
    } catch (error) {
      if (error instanceof ApiError && error.status === 426) { reportIncompatible("decisions.resolve"); setStatus("Answering requires a compatible AQ API. Your note is preserved."); setOutcome(null); return; }
      if (error instanceof ApiError && [400, 403, 404, 409].includes(error.status ?? 0)) { setStatus(error.status === 409 ? "The review changed. Your note is preserved; refresh the evidence before answering again." : "The server refused this answer. Your note is preserved; refresh the evidence before answering again."); setOutcome("refused"); }
      else { setStatus("Delivery is unknown. Inspect the review or retry the same answer; no new answer has been created."); setOutcome("uncertain"); }
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setStatus("Refreshing evidence…");
    try { await onRefresh(); } finally { setBusy(false); }
  }

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
      {available && <div className={styles.buttons}>
        {!pending.current ? <>
          <ActionButton className={styles.primary} disabled={busy} onClick={() => void submit("approve")}>Approve task version {d.taskVersion}</ActionButton>
          <ActionButton className={styles.secondary} disabled={busy} onClick={() => void submit("reject")}>Request changes</ActionButton>
        </> : outcome === "uncertain" ? <ActionButton className={styles.secondary} disabled={busy} onClick={() => void submit()}>Retry same answer</ActionButton>
          : outcome === "refused" && <ActionButton className={styles.secondary} disabled={busy} onClick={() => void refresh()}>Refresh evidence and answer again</ActionButton>}
      </div>}
    </div>
  </section>;
}
