import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../app/session";
import { ContractError } from "../../api/adapters/contract";
import { ApiError } from "../../api/client";
import { ActionButton } from "../../components/layout/Workspace";
import { actionRequest, type ActionOperation, type FrozenAction } from "../actions/actionClient";
import actionStyles from "../actions/RecordActions.module.css";
import { freezePlaybookAction, playbookCapability, playbookLabels, type PlaybookKind, type PlaybookSubject } from "./playbookActions";

export type PlaybookActionProps = {
  kind: PlaybookKind;
  /** The namespace's project; the operation's scope must match it. */
  project: string;
  subject: PlaybookSubject;
  /** A domain reason the control is unavailable (for example a finished run). */
  blocked?: string | undefined;
  /** Shown under the dialog title: what the action does and does not do. */
  intro?: ReactNode;
  /** Required confirmation text; omitted when the action needs none. */
  confirm?: string;
  /** Typed fields; `locked` once submitted so the draft is preserved but frozen. */
  fields?: (locked: boolean) => ReactNode;
  /** Validates the draft and returns the payload; throws an Error with a user message. */
  build: () => { payload: Record<string, unknown>; reason?: string };
  pendingText: string;
  confirmedText: string;
  onConfirmed?: () => void;
  /** Refreshes the subject after conflict or rejection; the draft stays. */
  onReload?: () => Promise<unknown> | void;
  /** Called when a fresh action starts (not when reopening an unsettled one). */
  onStart?: () => void;
  className?: string;
  /** Identity of this control's draft; defaults to the subject. Start passes a stable value so changing the binding keeps the dialog. */
  instance?: string;
};

export function PlaybookAction(props: PlaybookActionProps) {
  const { queryContext } = useSession();
  return <Action key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.project}:${props.instance ?? `${props.subject.type}:${props.subject.id}`}`} {...props} />;
}

type Status = ActionOperation["disposition"] | "retired";
function Action({ kind, project, subject, blocked, intro, confirm, fields, build, pendingText, confirmedText, onConfirmed, onReload, onStart, className }: PlaybookActionProps) {
  const { bootstrap, reportAccessDenied, reportIncompatible } = useSession();
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [intent, setIntent] = useState<FrozenAction | null>(null), [operation, setOperation] = useState<ActionOperation | null>(null);
  const [retired, setRetired] = useState(false), [unknown, setUnknown] = useState(false), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [accessLost, setAccessLost] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId(), lock = useRef(false), current = useRef(true), controller = useRef<AbortController | null>(null), firstLookup = useRef<string | null>(null);
  const union = bootstrap.capability("dashboard.actions"), capability = union.enabled ? bootstrap.capability(playbookCapability(kind)) : union;
  const unsettled = !!intent && (retired || unknown || !operation || operation.disposition === "pending" || operation.disposition === "unknown");
  const reason = accessLost ? "Access changed. Reload access" : !capability.enabled ? capability.reason : unsettled ? undefined : blocked;
  const label = playbookLabels[kind];
  useEffect(() => { current.current = true; return () => { current.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (open) { if (!dialog.current?.open) dialog.current?.showModal(); } else if (dialog.current?.open) dialog.current.close(); }, [open]);
  async function run(value: FrozenAction, lookup = false) {
    if (lock.current || accessLost) return; lock.current = true; setBusy(true); const abort = new AbortController(); controller.current = abort;
    try {
      const next = await actionRequest(value, lookup, abort.signal); if (!current.current) return;
      if (operation?.request_digest && operation.operation_id === next.operation_id && operation.request_digest !== next.request_digest) throw new ContractError("Operation identity changed");
      setOperation(next); setUnknown(false); setError(null);
      if (next.disposition === "confirmed") onConfirmed?.();
    } catch (failure) {
      if (!current.current) return;
      const status = failure instanceof ApiError ? failure.status ?? 0 : 0, envelope = failure instanceof ApiError ? failure.envelope : undefined;
      const settled = (disposition: "conflict" | "rejected", message: string) => { setOperation({ operation_id: value.id, disposition, request_digest: "", subject_refs: [], receipt_refs: [], affected_entities: [], ...(disposition === "conflict" ? { current_versions: envelope?.current_versions } : {}), recovery: "refresh_and_review" }); setUnknown(false); setError(envelope?.message ?? message); };
      if (failure instanceof ApiError && (status === 401 || status === 403)) { setAccessLost(true); setOperation(null); reportAccessDenied(failure); setError("Access changed. Reload access before checking the operation."); }
      else if (failure instanceof ApiError && status === 426) { reportIncompatible("dashboard.actions"); setUnknown(true); }
      else if (failure instanceof ApiError && status === 410) { setRetired(true); setUnknown(false); setError(null); }
      else if (!lookup && failure instanceof ApiError && status === 409) settled("conflict", "The expected version has changed.");
      else if (!lookup && failure instanceof ApiError && !failure.effectUnknown && [400, 404, 413, 422].includes(status)) settled("rejected", "The server refused this action. Review the playbook and permissions.");
      else { setUnknown(true); setError(null); }
    } finally { lock.current = false; if (current.current) setBusy(false); if (controller.current === abort) controller.current = null; }
  }
  // Reconcile immediately after admission uncertainty; later lookups are paced.
  useEffect(() => {
    if (!intent || !unsettled || busy || accessLost || retired) return;
    const delay = firstLookup.current === intent.id ? 2000 : 0; firstLookup.current = intent.id;
    const timer = setTimeout(() => void run(intent, true), delay); return () => clearTimeout(timer);
  }, [intent, unsettled, busy, accessLost, retired]);
  function reset() { setIntent(null); setOperation(null); setRetired(false); setUnknown(false); setError(null); setConfirmed(false); }
  function launch() { if (!unsettled) { reset(); onStart?.(); } setOpen(true); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (lock.current || intent || !capability.enabled || blocked) return;
    try {
      const { payload, reason: why } = build();
      if (confirm && !confirmed) throw new Error("Confirm this action before submitting.");
      const value = freezePlaybookAction(kind, project, subject, payload, why); setIntent(value); setError(null); await run(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review the form."); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await onReload?.(); if (current.current) reset(); }
    catch { if (current.current) setError("Current versions could not be loaded. Your draft is preserved."); }
    finally { lock.current = false; if (current.current) setBusy(false); }
  }
  const status: Status | undefined = retired ? "retired" : unknown ? "unknown" : operation?.disposition;
  const locked = busy || !!intent || accessLost;
  return <div className={`${actionStyles.action} ${className ?? ""}`}>
    <ActionButton disabled={!!reason} title={reason} onClick={launch}>{label}{unsettled ? " · operation" : ""}</ActionButton>
    {reason && <span className={actionStyles.meta}>{reason}</span>}
    <dialog className={actionStyles.dialog} ref={dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <header className={actionStyles.header}><h2 id={titleId}>{label}</h2><ActionButton onClick={() => setOpen(false)} aria-label="Close action">Close</ActionButton></header>
      {intro && <div className={actionStyles.meta}>{intro}</div>}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={e => void submit(e)}><fieldset className={actionStyles.fields} disabled={locked}>
        {fields?.(locked)}
        {confirm && <label className={actionStyles.confirm}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{confirm}</label>}
      </fieldset>{!intent && <ActionButton type="submit" disabled={busy || accessLost || !capability.enabled || !!blocked}>Submit</ActionButton>}</form>
      {intent && <section className={actionStyles.operation} aria-label="Action status">
        <p role="status">{status === "retired" ? "Receipt details expired — the outcome is unavailable. Keep the original operation reference; do not submit it as a new operation." : status === "confirmed" ? confirmedText : status === "conflict" ? "Conflict — your draft is preserved." : status === "rejected" ? "Rejected — the server did not permit this action. Review the playbook and permissions." : status === "pending" ? pendingText : "Outcome unknown — keep this operation and check its status."}</p>
        {operation?.current_versions && Object.keys(operation.current_versions).length > 0 && <p>Current versions: {Object.entries(operation.current_versions).map(([key, value]) => `${key}: ${value}`).join(", ")}</p>}
        <div className={actionStyles.footer}>
          {unsettled && !retired && <><ActionButton disabled={busy || accessLost} onClick={() => void run(intent, true)}>Check status</ActionButton><ActionButton disabled={busy || accessLost || !capability.enabled} onClick={() => void run(intent)}>Retry exact submission</ActionButton></>}
          {(status === "conflict" || status === "rejected") && <ActionButton disabled={busy || accessLost} onClick={() => void reload()}>Reload current versions</ActionButton>}
        </div>
        <details className={actionStyles.reference}><summary>Operation reference and receipts</summary><p>{intent.id}</p>{operation?.request_digest && <p>{operation.request_digest}</p>}{operation?.receipt_refs.map((r, i) => <p key={i}>{r.type} · {r.id}{r.revision ? ` · version ${r.revision}` : ""}</p>)}</details>
      </section>}
    </dialog>
  </div>;
}
